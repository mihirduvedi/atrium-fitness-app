import { defineConfig } from 'vitest/config';

// Tests here cover the Node-testable layers (db schema, DAO SQL, sync
// protocol) against node:sqlite — not React components.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
