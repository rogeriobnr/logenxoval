import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/serverlessApp.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  splitting: false,
  bundle: true,
  platform: 'node',
  external: [],
  dts: true,
});