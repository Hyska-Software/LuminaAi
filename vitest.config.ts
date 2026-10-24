import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@data': path.resolve(import.meta.dirname, './data'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
});
