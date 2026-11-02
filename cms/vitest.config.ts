import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests share one PostgreSQL test database, so files run one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000
  }
});
