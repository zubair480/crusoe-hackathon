import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/web/**/*.test.ts', 'packages/excel/**/*.test.ts'] } });
