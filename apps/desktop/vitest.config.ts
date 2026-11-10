import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'desktop', include: ['tests/**/*.test.ts'], environment: 'node' } });
