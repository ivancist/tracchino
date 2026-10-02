import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./db/migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./worker/index.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Tests never use the dev bypass; Access config points at a fake team (keys injected in tests).
          bindings: {
            TEST_MIGRATIONS: migrations,
            DEV_AUTH_BYPASS: "false",
            ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com",
            ACCESS_AUD: "test-aud",
            ALLOWED_EMAIL: "owner@example.com",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup/apply-migrations.ts"],
    },
  };
});
