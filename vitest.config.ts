import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // 分章/pdf 等用例涉及磁盘与 zip，单线程更稳
    pool: "forks",
    testTimeout: 20000,
  },
});
