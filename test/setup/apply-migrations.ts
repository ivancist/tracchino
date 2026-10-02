import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Cloudflare.Env is extended via declaration merging
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
