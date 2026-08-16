import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

function crossOriginIsolation(): Plugin {
	return {
		name: 'cross-origin-isolation',
		configureServer(server) {
			server.middlewares.use((_req, res, next) => {
				const req = _req as typeof _req & { url?: string };
				// Only apply COOP/COEP on editor routes (needed for FFmpeg SharedArrayBuffer)
				if (req.url?.startsWith('/edit')) {
					res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
					res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
				}
				next();
			});
		},
		configurePreviewServer(server) {
			server.middlewares.use((_req, res, next) => {
				const req = _req as typeof _req & { url?: string };
				if (req.url?.startsWith('/edit')) {
					res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
					res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
				}
				next();
			});
		},
	};
}

export default defineConfig({
	plugins: [crossOriginIsolation(), sveltekit()],
	server: {
		// Pinned rather than passed on the command line: the Tauri shell's
		// devUrl points here, and it must not silently drift to 5174 when
		// another dev server already holds the port.
		port: 5173,
		strictPort: true,
		proxy: {
			'/api': {
				target: 'http://localhost:8080',
				changeOrigin: true,
			},
		},
	},
	optimizeDeps: {
		exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
	},
});
