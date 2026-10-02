import { describe, expect, it } from "vitest";
import { createTestApi } from "../helpers/api";

describe("every registered /api route requires authentication", async () => {
  const api = await createTestApi();
  const routes = api.app.routes
    .filter((r) => r.method !== "ALL") // middleware entries
    .map((r) => ({ method: r.method, path: r.path.replace(/:[a-zA-Z]+/g, "1") }));

  it("discovers the routes (guards against an empty list)", () => {
    expect(routes.length).toBeGreaterThan(15);
  });

  it.each(routes)("$method $path → 401 without token", async ({ method, path }) => {
    const body = ["POST", "PUT", "PATCH"].includes(method) ? {} : undefined;
    const res = await api.call(method, path, body, { auth: false });
    expect(res.status).toBe(401);
  });
});
