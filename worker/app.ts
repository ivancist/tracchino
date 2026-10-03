import { Hono } from "hono";
import { toHttpError } from "./http";
import { accessAuth, remoteKeySet, sameOriginOnly, type AuthVariables, type KeySetFactory } from "./middleware/auth";
import { chainRoutes } from "./routes/chains";
import { groupRoutes } from "./routes/groups";
import { meRoutes } from "./routes/me";
import { productRoutes } from "./routes/products";
import { receiptRoutes } from "./routes/receipts";
import { createScanRoutes, type AiFactory } from "./routes/scan";
import { createGemini } from "./services/ai/gemini";
import { statsRoutes } from "./routes/stats";
import { storeRoutes } from "./routes/stores";

export type AppEnv = { Bindings: Env; Variables: AuthVariables };

/** Production AI: Gemini when its key is configured, otherwise scanning is disabled (503). */
const geminiFromEnv: AiFactory = (env) =>
  env.GEMINI_API_KEY ? createGemini({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }) : null;

export function createApp(options: { keySet?: KeySetFactory; ai?: AiFactory } = {}) {
  const app = new Hono<AppEnv>().basePath("/api");

  // Must stay first: no cross-site writes, and every /api route is authenticated.
  app.use("*", sameOriginOnly());
  app.use("*", accessAuth(options.keySet ?? remoteKeySet));

  app.route("/me", meRoutes);
  app.route("/chains", chainRoutes);
  app.route("/stores", storeRoutes);
  app.route("/groups", groupRoutes);
  app.route("/products", productRoutes);
  app.route("/receipts/scan", createScanRoutes(options.ai ?? geminiFromEnv));
  app.route("/receipts", receiptRoutes);
  app.route("/stats", statsRoutes);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    const httpError = toHttpError(err);
    if (httpError) return c.json(httpError.body, httpError.status);
    // Message only: the full error can carry SQL and bound values into Workers logs.
    console.error(`unhandled error on ${c.req.method} ${c.req.path}:`, err instanceof Error ? err.message.slice(0, 200) : "unknown");
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
