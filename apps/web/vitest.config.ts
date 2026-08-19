import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// The Svelte plugin is here so `.svelte.ts` modules compile: a state class
	// written in runes is otherwise a `$state is not defined` ReferenceError
	// the moment a test constructs it, which is why none of the stores had
	// tests.
	plugins: [svelte({ hot: false })],
	test: {
		include: ['src/**/*.test.ts'],
	},
	resolve: {
		conditions: ['browser'],
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname,
		},
	},
});
