import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Definition of done (brief Part H): engine coverage >90% on the rule
      // and bounds modules. CI fails below these.
      thresholds: {
        'src/rules.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/bounds.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});
