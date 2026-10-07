import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // editor/src tests cover pure UI logic only — the editor has no DOM test harness.
    include: ['src/**/*.test.ts', 'editor/src/**/*.test.ts'],
  },
});
