import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Workspace-wide flat ESLint baseline.
 *
 * Scope: repair ESLint resolution so `pnpm -r lint` runs and gates CI. The
 * ruleset is intentionally pragmatic — real correctness rules error, while
 * stylistic/noise rules that the existing codebase does not yet satisfy are
 * downgraded to warnings so lint is green and can be enforced (blocking) in CI.
 * Tighten rules incrementally over time.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.d.ts",
      "**/prisma/generated/**",
      "**/generated/**",
      "**/hometax-securemail/vendor/**", // vendored minified CryptoJS (NTS hometax) — not our code
      ".worktrees/**",
      ".claude/**",
      ".serena/**",
      ".superpowers/**",
      ".omo/**",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      // Downgrade existing-codebase noise to warnings (non-blocking).
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      // Namespaces are still required for Express/global type augmentation.
      "@typescript-eslint/no-namespace": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "no-control-regex": "warn",
      "no-prototype-builtins": "warn",
    },
  },
  {
    // Tests and scripts use looser globals/patterns.
    files: ["**/*.test.{ts,tsx,mjs,js}", "scripts/**", "**/*.mjs"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
