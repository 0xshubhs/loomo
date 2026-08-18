import { describe, it, expect, vi } from 'vitest';
import { scanDevices } from './devices.js';

/**
 * Finding the camera and microphone.
 *
 * The recorder reported "No cameras found" and "No microphones found" on a
 * machine with two cameras and a working mic. Two causes: WebKitGTK refuses
 * `getUserMedia` unless the host answers its permission-request signal (fixed
 * in the Rust shell), and this code asked for audio and video in a single
 * call, so one refusal emptied both lists.
 */

type Device = { deviceId: string; kind: MediaDeviceKind; label: string };

const CAMERA: Device = { deviceId: 'cam-1', kind: 'videoinput', label: 'Integrated Webcam' };
const MIC: Device = { deviceId: 'mic-1', kind: 'audioinput', label: 'Digital Microphone' };
const SPEAKER: Device = { deviceId: 'out-1', kind: 'audiooutput', label: 'Speakers' };

function domError(name: string): DOMException {
	const error = new Error(name);
	error.name = name;
	return error as DOMException;
}

/**
 * Stands in for `navigator.mediaDevices`, answering each constraint on its own
 * so a machine can plausibly have one kind of device and not the other — the
 * case the old code got wrong.
 */
function fakeMedia(options: {
	devices: Device[];
	video?: DOMException | null;
	audio?: DOMException | null;
}) {
	const stopped: string[] = [];
	const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
		const failure = constraints.video ? options.video : options.audio;
		if (failure) throw failure;
		return {
			getTracks: () => [{ stop: () => stopped.push(JSON.stringify(constraints)) }],
		} as unknown as MediaStream;
	});

	const media = {
		getUserMedia,
		enumerateDevices: vi.fn(async () => options.devices as unknown as MediaDeviceInfo[]),
	} as unknown as MediaDevices;

	return { media, getUserMedia, stopped };
}

describe('enumerating capture devices', () => {
	it('lists cameras and microphones, ignoring outputs', async () => {
		const { media } = fakeMedia({ devices: [CAMERA, MIC, SPEAKER] });

		const scan = await scanDevices(media);

		expect(scan.cameras.map((c) => c.label)).toEqual(['Integrated Webcam']);
		expect(scan.microphones.map((m) => m.label)).toEqual(['Digital Microphone']);
	});

	it('asks for video and audio separately', async () => {
		// Combined, one missing device takes the other down with it.
		const { media, getUserMedia } = fakeMedia({ devices: [CAMERA, MIC] });

		await scanDevices(media);

		expect(getUserMedia.mock.calls.map(([c]) => c)).toEqual([{ video: true }, { audio: true }]);
	});

	it('still finds the microphone when there is no camera', async () => {
		const { media } = fakeMedia({ devices: [MIC], video: domError('NotFoundError') });

		const scan = await scanDevices(media);

		expect(scan.microphones).toHaveLength(1);
		expect(scan.cameras).toHaveLength(0);
	});

	it('still finds the camera when the microphone is refused', async () => {
		const { media } = fakeMedia({ devices: [CAMERA], audio: domError('NotAllowedError') });

		const scan = await scanDevices(media);

		expect(scan.cameras).toHaveLength(1);
	});

	it('releases the streams it opened only to ask for permission', async () => {
		// Leaving them running holds the camera light on and locks the device
		// against the recording that follows.
		const { media, stopped } = fakeMedia({ devices: [CAMERA, MIC] });

		await scanDevices(media);

		expect(stopped).toHaveLength(2);
	});

	it('falls back to an id-derived label when access gave no name', async () => {
		const { media } = fakeMedia({ devices: [{ ...CAMERA, label: '' }] });

		const scan = await scanDevices(media);

		expect(scan.cameras[0].label).toBe('Camera cam-');
	});

	it('tags each device with its kind', async () => {
		const { media } = fakeMedia({ devices: [CAMERA, MIC] });

		const scan = await scanDevices(media);

		expect(scan.cameras[0].kind).toBe('videoinput');
		expect(scan.microphones[0].kind).toBe('audioinput');
	});
});

describe('explaining why nothing was found', () => {
	it('says access was blocked rather than showing an empty list', async () => {
		// The state the desktop was stuck in: the webview refused permission,
		// so no device could be seen at all.
		const { media } = fakeMedia({
			devices: [],
			video: domError('NotAllowedError'),
			audio: domError('NotAllowedError'),
		});

		const scan = await scanDevices(media);

		expect(scan.error).toMatch(/blocked/i);
	});

	it('says so when another application holds the device', async () => {
		const { media } = fakeMedia({
			devices: [],
			video: domError('NotReadableError'),
			audio: domError('NotReadableError'),
		});

		const scan = await scanDevices(media);

		expect(scan.error).toMatch(/another application/i);
	});

	it('stays quiet when the machine simply has no camera', async () => {
		const { media } = fakeMedia({ devices: [MIC], video: domError('NotFoundError') });

		const scan = await scanDevices(media);

		expect(scan.error).toBeNull();
	});

	it('stays quiet when a refusal cost nothing', async () => {
		// Both kinds turned up anyway; complaining would be noise.
		const { media } = fakeMedia({ devices: [CAMERA, MIC], video: domError('NotAllowedError') });

		const scan = await scanDevices(media);

		expect(scan.error).toBeNull();
	});

	it('stays quiet when everything was found', async () => {
		const { media } = fakeMedia({ devices: [CAMERA, MIC] });

		const scan = await scanDevices(media);

		expect(scan.error).toBeNull();
	});

	it('reports a build with no media API at all', async () => {
		const scan = await scanDevices(undefined);

		expect(scan.error).toMatch(/cannot reach capture devices/i);
		expect(scan.cameras).toEqual([]);
	});
});
