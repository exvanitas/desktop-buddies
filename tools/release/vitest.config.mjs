import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'release', include: ['tests/**/*.test.mjs'], environment: 'node' } });
