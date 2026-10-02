import { env, exports } from "cloudflare:workers";
import { generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../worker/app";
import { createFakeAccess, TEST_EMAIL } from "./helpers/access";

const PROD_URL = "https://tracchino.example.workers.dev";

let access: Awaited<ReturnType<typeof createFakeAccess>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  access = await createFakeAccess();
  app = createApp({ keySet: access.keySet });
});

function get(path: string, token?: string, envOverride: Record<string, string> = {}, base = PROD_URL) {
  const headers: Record<string, string> = token ? { "Cf-Access-Jwt-Assertion": token } : {};
  return app.request(`${base}${path}`, { headers }, { ...env, ...envOverride });
}

describe("Access JWT middleware", () => {
  it("accepts a valid token for the allowed email", async () => {
    const res = await get("/api/me", await access.sign());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: TEST_EMAIL, db: "ok" });
  });

  it("compares the email case-insensitively", async () => {
    const res = await get("/api/me", await access.sign({ email: TEST_EMAIL.toUpperCase() }));
    expect(res.status).toBe(200);
  });

  it.each([
    ["missing token", async () => undefined],
    ["garbage token", async () => "not-a-jwt"],
    ["other email", async () => access.sign({ email: "someone@example.com" })],
    ["no email claim", async () => access.sign({ email: undefined })],
    ["wrong audience", async () => access.sign({}, { aud: "other-app" })],
    ["wrong issuer", async () => access.sign({}, { iss: "https://evil.cloudflareaccess.com" })],
    ["expired", async () => access.sign({}, { exp: Math.floor(Date.now() / 1000) - 60 })],
    [
      "signed by an unknown key",
      async () => access.sign({}, { key: (await generateKeyPair("RS256")).privateKey }),
    ],
    [
      "unsigned (alg none)",
      async () => {
        const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
        return `${b64({ alg: "none", kid: "test-key" })}.${b64({ email: TEST_EMAIL, aud: "test-aud" })}.`;
      },
    ],
  ])("rejects %s with 401", async (_name, makeToken) => {
    const res = await get("/api/me", await makeToken());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("fails closed when Access config is missing", async () => {
    const token = await access.sign();
    expect((await get("/api/me", token, { ACCESS_AUD: "" })).status).toBe(401);
    expect((await get("/api/me", token, { ACCESS_TEAM_DOMAIN: "" })).status).toBe(401);
    expect((await get("/api/me", token, { ALLOWED_EMAIL: "" })).status).toBe(401);
  });

  it("protects unknown /api routes too (401 before 404)", async () => {
    expect((await get("/api/does-not-exist")).status).toBe(401);
    expect((await get("/api/does-not-exist", await access.sign())).status).toBe(404);
  });
});

describe("dev auth bypass", () => {
  const bypass = { DEV_AUTH_BYPASS: "true" };

  it("is ignored on non-loopback hosts", async () => {
    expect((await get("/api/me", undefined, bypass)).status).toBe(401);
  });

  it("works only on localhost", async () => {
    const res = await get("/api/me", undefined, bypass, "http://localhost:5173");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: TEST_EMAIL });
  });

  it("is off when the flag is not exactly 'true'", async () => {
    const res = await get("/api/me", undefined, { DEV_AUTH_BYPASS: "1" }, "http://localhost:5173");
    expect(res.status).toBe(401);
  });
});

describe("deployed Worker entrypoint", () => {
  it("rejects unauthenticated /api requests", async () => {
    const res = await exports.default.fetch(`${PROD_URL}/api/me`);
    expect(res.status).toBe(401);
  });
});
