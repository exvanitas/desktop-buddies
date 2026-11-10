import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'art', include: ['tests/**/*.test.ts'], environment: 'node' } });
