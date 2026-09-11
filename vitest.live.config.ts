import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.live.spec.ts"],
    testTimeout: 90_000,
    disableConsoleIntercept: true,
  },
});
