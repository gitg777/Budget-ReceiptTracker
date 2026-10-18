import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The React app builds into dist/; the Worker (wrangler) serves it and answers /api/*.
// `npm run dev` proxies /api to `wrangler dev` on port 8787.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: 'dist' },
});
