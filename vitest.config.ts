// M43: deliberately separate from vite.config.ts, which is a wrapped
// @lovable.dev/vite-tanstack-config config that explicitly warns against
// adding plugins manually (see its own comment) — test config lives here
// instead of risking a collision with that. resolve.tsconfigPaths gives
// tests the same "@/*" -> "src/*" alias the app itself uses, for any test
// file that ends up needing it later.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
