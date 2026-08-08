import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/main/**/*.ts",
        "src/shared/**/*.ts",
        "src/preload/**/*.ts",
        "src/renderer/**/lib/**/*.ts"
      ],
      exclude: [
        "src/**/*.test.ts",
        "src/main/index.ts",
        "src/shared/i18n/locales/**",
        "src/renderer/main/lib/icons.ts"
      ]
    }
  },
});
