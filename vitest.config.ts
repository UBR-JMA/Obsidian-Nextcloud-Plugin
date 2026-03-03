import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: new URL('./__mocks__/obsidian.ts', import.meta.url).pathname,
		},
	},
	test: {
		globals: true,
		environment: 'node',
	},
});
