import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), 'ATRIUM_'));
  return {
    test: {
      include: ['eval/liveCoachEval.ts'],
      environment: 'node',
      fileParallelism: false,
      testTimeout: 125_000,
      hookTimeout: 20_000,
    },
  };
});
