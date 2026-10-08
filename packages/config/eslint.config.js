import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["coverage/**", "dist/**"] },
  ...tseslint.configs.recommended,
);
