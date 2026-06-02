import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["react-server", "node", "import", "default"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
