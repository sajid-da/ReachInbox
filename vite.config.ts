import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const renderHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
      '/auth': 'http://localhost:4000',
    },
  },
  preview: {
    allowedHosts: renderHostname ? [renderHostname] : undefined,
  },
  build: { outDir: 'dist/client' },
});
