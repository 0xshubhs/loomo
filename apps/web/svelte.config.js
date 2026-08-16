import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';

// The desktop shell loads the app off disk inside a webview, so it needs a
// static SPA bundle rather than the Node server the web deployment uses.
// Everything else about the build is identical.
const desktop = process.env.LOOMO_DESKTOP === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: desktop
			? adapterStatic({
					pages: 'build-desktop',
					assets: 'build-desktop',
					fallback: 'index.html',
					precompress: false,
					strict: false
				})
			: adapterNode({ out: 'build' }),
		alias: {
			'@dittoo/shared': '../../packages/shared/src'
		}
	}
};

export default config;
