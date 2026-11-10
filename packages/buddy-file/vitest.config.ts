import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'buddy-file', include: ['tests/**/*.test.ts'], environment: 'node' } });
