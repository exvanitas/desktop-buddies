import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'validate-buddy', include: ['tests/**/*.test.ts'], environment: 'node' } });
