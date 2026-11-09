import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv();

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
