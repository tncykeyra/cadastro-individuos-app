import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/cadastro-individuos-app/' : './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        reactPreview: resolve(process.cwd(), 'react-preview.html'),
      },
    },
  },
});
