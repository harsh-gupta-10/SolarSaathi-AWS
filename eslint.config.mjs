import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const webFiles = ["apps/web/**/*.{ts,tsx,js,mjs}"];
const nextConfigs = compat.extends("next/core-web-vitals");
const nextPlugin = nextConfigs.find((config) => config.plugins?.["@next/next"]).plugins["@next/next"];
const nextSettings = { rootDir: `${import.meta.dirname}/apps/web/` };

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**",
      ".aws-sam/**", ".agents/**", "google-cloud-sdk/**", "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { plugins: { "@next/next": nextPlugin }, settings: { next: nextSettings } },
  ...nextConfigs.map((config) => ({
    ...config,
    files: webFiles,
    settings: { ...config.settings, next: nextSettings },
  })),
  {
    files: webFiles,
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@solarsaathi/config/server", "@aws-sdk/*", "aws-sdk"], message: "Use backend APIs; server configuration and AWS clients do not belong in the web app." },
        ],
      }],
    },
  },
);
