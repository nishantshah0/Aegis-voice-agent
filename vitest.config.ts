import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // vitest.setup.ts clears DATABASE_URL first, so no test can reach the shared demo database.
  test: { include: ["**/*.test.ts"], exclude: ["node_modules", ".next", "planning"], setupFiles: ["./vitest.setup.ts"] },
});
