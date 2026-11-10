import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'maker-view', include: ['tests/**/*.test.ts'], environment: 'node' } });
