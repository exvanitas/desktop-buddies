import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tools/*'],
    testTimeout: 60000
  }
});
