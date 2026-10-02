import { Hono } from "hono";
import { accessAuth, remoteKeySet, type AuthVariables, type KeySetFactory } from "./middleware/auth";
import { meRoutes } from "./routes/me";

export type AppEnv = { Bindings: Env; Variables: AuthVariables };

export function createApp(options: { keySet?: KeySetFactory } = {}) {
  const app = new Hono<AppEnv>().basePath("/api");

  // Must stay first: every /api route is authenticated.
  app.use("*", accessAuth(options.keySet ?? remoteKeySet));

  app.route("/me", meRoutes);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error("unhandled error", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
