import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'terrain', include: ['tests/**/*.test.ts'], environment: 'node' } });
