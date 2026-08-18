import type { DeviceInfo } from '$lib/types/recorder.js';

/**
 * Finding the camera and microphone.
 *
 * Kept out of the store so it can be tested directly: the store is a runes
 * module, and importing one outside a Svelte build is not possible.
 *
 * The subtlety here is that access has to be requested for each kind
 * separately. Asking for `{ audio: true, video: true }` in one call fails
 * entirely if either half is refused, so a machine with a working microphone
 * and no camera — or a camera another application already holds — reports
 * neither device.
 */

export interface DeviceScan {
	cameras: DeviceInfo[];
	microphones: DeviceInfo[];
	/** Why the lists are short, phrased for a user rather than a console. */
	error: string | null;
}

const EMPTY: DeviceScan = { cameras: [], microphones: [], error: null };

export async function scanDevices(media: MediaDevices | undefined): Promise<DeviceScan> {
	if (!media?.enumerateDevices) {
		return { ...EMPTY, error: 'This build cannot reach capture devices.' };
	}

	const refusals = (
		await Promise.all([requestAccess(media, { video: true }), requestAccess(media, { audio: true })])
	).filter((error): error is DOMException => error !== null);

	// Ids are enumerable without permission even though labels are not, so this
	// runs whatever happened above.
	const devices = await media.enumerateDevices();
	const cameras = devices.filter((d) => d.kind === 'videoinput').map(toDeviceInfo('Camera'));
	const microphones = devices.filter((d) => d.kind === 'audioinput').map(toDeviceInfo('Microphone'));

	return { cameras, microphones, error: describeFailure(refusals, cameras, microphones) };
}

function toDeviceInfo(kindLabel: 'Camera' | 'Microphone') {
	const kind = kindLabel === 'Camera' ? ('videoinput' as const) : ('audioinput' as const);
	return (device: MediaDeviceInfo): DeviceInfo => ({
		deviceId: device.deviceId,
		// Without permission the label is blank; an id fragment at least
		// distinguishes two cameras from each other.
		label: device.label || `${kindLabel} ${device.deviceId.slice(0, 4)}`,
		kind,
	});
}

/** Resolves to null on success, or to the error explaining the refusal. */
async function requestAccess(
	media: MediaDevices,
	constraints: MediaStreamConstraints
): Promise<DOMException | null> {
	try {
		const stream = await media.getUserMedia(constraints);
		stream.getTracks().forEach((track) => track.stop());
		return null;
	} catch (error) {
		console.warn(`Device access refused for ${JSON.stringify(constraints)}:`, error);
		return error as DOMException;
	}
}

function describeFailure(
	refusals: DOMException[],
	cameras: DeviceInfo[],
	microphones: DeviceInfo[]
): string | null {
	if (refusals.length === 0) return null;
	// Both kinds turned up regardless, so whatever was refused did not matter.
	if (cameras.length > 0 && microphones.length > 0) return null;

	const names = new Set(refusals.map((error) => error.name));
	if (names.has('NotAllowedError')) {
		return 'Camera and microphone access was blocked. Check your system privacy settings, then try again.';
	}
	if (names.has('NotReadableError')) {
		return 'A capture device is in use by another application.';
	}
	// A machine that genuinely has no camera is not a fault worth reporting.
	if (names.has('NotFoundError')) return null;
	return 'Could not open capture devices.';
}
