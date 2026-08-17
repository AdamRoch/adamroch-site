import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'lab/living-world': fileURLToPath(new URL('./lab/living-world/index.html', import.meta.url)),
      },
    },
  },
});
