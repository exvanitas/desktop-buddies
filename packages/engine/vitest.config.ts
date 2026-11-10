import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'engine', include: ['tests/**/*.test.ts'], environment: 'node' } });
