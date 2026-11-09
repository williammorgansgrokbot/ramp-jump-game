import { defineConfig } from 'vite';

export default defineConfig({
  base: '/ramp-jump-game/',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
