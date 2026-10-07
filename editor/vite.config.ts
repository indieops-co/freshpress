import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const editorRoot = dirname(fileURLToPath(import.meta.url));
const paidEntry = resolve(editorRoot, '../src/paid/editor/index.tsx');

export default defineConfig({
  plugins: [react()],
  base: '/editor/',
  resolve: {
    // Paid-overlay seam: '@paid' → the real overlay surface when src/paid/ exists
    // (paid build), the upgrade-CTA stub otherwise (free build). Type-checking always
    // resolves '@paid' to the stub via tsconfig paths, so signatures must stay in sync.
    alias: {
      '@paid': existsSync(paidEntry) ? paidEntry : resolve(editorRoot, 'src/paid-stub.tsx'),
    },
    // Paid editor files live OUTSIDE editor/ — without dedupe their bare react
    // imports would resolve up into the backend's node_modules (second React copy
    // → hooks crash).
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] }, // dev-mode: serve ../src/paid/editor/* when present
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
