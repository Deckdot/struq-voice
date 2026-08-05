import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/release/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/docs/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Explicit projects rather than projectService: the solution-style
        // root tsconfig (files: [] + references) is not loaded by the
        // type-aware service, which leaves every file unmatched. Each linted
        // file must belong to exactly one of these projects.
        project: ["./tsconfig.node.json", "./tsconfig.web.json", "./tsconfig.e2e.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { project: false },
      globals: {
        process: "readonly",
        console: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
      },
    },
  },
);
