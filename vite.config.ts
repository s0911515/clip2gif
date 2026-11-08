import { defineConfig } from 'vite';

export default defineConfig({
  // @jsquash/webp は wasm を import.meta.url から読むので、事前バンドルの対象から外す
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
