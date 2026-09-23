import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

function copyManifestIcons() {
  const from = join(rootDir, 'src', 'assets', 'icon.svg');
  return {
    name: 'copy-manifest-icon',
    writeBundle() {
      const toDir = join(rootDir, 'dist', 'assets');
      if (!existsSync(toDir)) mkdirSync(toDir, { recursive: true });
      copyFileSync(from, join(toDir, 'icon.svg'));
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifestIcons()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '/users': { target: 'http://localhost:3000', changeOrigin: true },
      '/deposits': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});