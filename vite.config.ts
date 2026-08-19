import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'lab/living-world': fileURLToPath(new URL('./lab/living-world/index.html', import.meta.url)),
        'lab/event-horizon': fileURLToPath(new URL('./lab/event-horizon/index.html', import.meta.url)),
        'lab/sonic-terrain': fileURLToPath(new URL('./lab/sonic-terrain/index.html', import.meta.url)),
      },
    },
  },
});
