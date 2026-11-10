import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'maker-core', include: ['tests/**/*.test.ts'], environment: 'node' } });
