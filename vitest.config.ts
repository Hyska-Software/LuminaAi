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
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['default'],
    // The UI suite uses jsdom + user-event; the default 5 s is too tight when
    // cargo/build jobs share the CPU (flaky ModelPill/ModelPicker timeouts).
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});