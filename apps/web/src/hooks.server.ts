import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Only apply cross-origin isolation headers on editor routes
	// (needed for FFmpeg SharedArrayBuffer)
	if (event.url.pathname.startsWith('/edit')) {
		response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
		response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
	}

	return response;
};
