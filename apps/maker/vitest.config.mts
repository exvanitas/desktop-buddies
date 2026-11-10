import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'maker', include: ['tests/**/*.test.ts'], environment: 'node' } });
