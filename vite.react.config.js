import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: rootDir,
  base: './',
  build: {
    outDir: resolve(rootDir, 'dist-react-preview'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(rootDir, 'react-preview.html'),
    },
  },
});
