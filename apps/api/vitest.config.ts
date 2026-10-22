import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://glimpse_app:testpass@localhost:5433/glimpse_test",
      MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL ?? "postgres://postgres@localhost:5433/glimpse_test?host=/tmp",
      APP_DB_PASSWORD: "testpass",
      APP_ORIGIN: "http://localhost:3000",
      MEDIA_DIR: "/tmp/glimpse-test-media",
    },
  },
});
