import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
const testDirectory = process.env.HOUSIK_TEST_DIR;
export default defineConfig({
  cacheDir: testDirectory ? `${testDirectory}/vite-cache` : undefined,
  plugins: [
    sveltekit({
      adapter: adapter({ out: testDirectory ? `${testDirectory}/build` : 'build' }),
      preprocess: vitePreprocess(),
      outDir: testDirectory ? `${testDirectory}/kit` : '.svelte-kit'
    })
  ]
});
