import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      include: ["tests/unit/**/*.test.ts"],
      // jsdom doesn't implement IndexedDB — local-db.ts and anything that
      // imports it need a real (fake) implementation to run under Vitest.
      setupFiles: ["./tests/setup.ts"],
    },
  }),
);
