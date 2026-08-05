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
      "**/docs/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // One lint-only project covering every TS file. The per-process
        // isolation (node vs web vs e2e) is enforced by `pnpm typecheck`,
        // which runs the three real configs; a single lint project avoids
        // both the multi-project conflict of shared files and the default
        // project fallback that silently drops ambient declarations.
        project: ["./tsconfig.lint.json"],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" }
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: false },
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly"
      }
    }
  }
);
