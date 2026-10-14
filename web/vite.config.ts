import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works at https://<you>.github.io/<repo>/ and locally.
  base: './',
  plugins: [react()],
  build: { target: 'es2022' },
  server: { port: 5173 },
});
