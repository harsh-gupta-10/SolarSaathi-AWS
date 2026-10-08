import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["infra/sam/*.test.ts"] } });
