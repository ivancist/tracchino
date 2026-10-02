import { env } from "cloudflare:workers";
import type { ProductInput, ReceiptInput, StoreInput } from "../../shared/schemas";
import { createApp } from "../../worker/app";
import { createFakeAccess } from "./access";

export const BASE = "https://tracchino.example.workers.dev";

export type TestResponse<T = unknown> = { status: number; body: T };

/** Authenticated client against the real app (fake Access issuer, real local D1). */
export async function createTestApi() {
  const access = await createFakeAccess();
  const app = createApp({ keySet: access.keySet });
  const token = await access.sign();

  async function call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts: { auth?: boolean; rawBody?: string; headers?: Record<string, string> } = {},
  ): Promise<TestResponse<T>> {
    const headers: Record<string, string> = { ...(opts.rawBody != null ? { "Content-Type": "application/json" } : {}) };
    if (opts.auth !== false) headers["Cf-Access-Jwt-Assertion"] = token;
    let payload: string | undefined = opts.rawBody;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    Object.assign(headers, opts.headers);
    const res = await app.request(`${BASE}${path}`, { method, headers, body: payload }, env);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  const api = {
    app,
    call,
    get: <T = unknown>(path: string) => call<T>("GET", path),
    post: <T = unknown>(path: string, body: unknown) => call<T>("POST", path, body),
    patch: <T = unknown>(path: string, body: unknown) => call<T>("PATCH", path, body),
    put: <T = unknown>(path: string, body: unknown) => call<T>("PUT", path, body),
    del: <T = unknown>(path: string) => call<T>("DELETE", path),

    /** Factories: create via the API and return the new id (fails the test on non-201). */
    async chain(name = "Esselunga") {
      return created(await call("POST", "/api/chains", { name }));
    },
    async store(input: Partial<StoreInput> = {}) {
      const chainId = input.chainId ?? (await api.chain(`Catena ${Math.random()}`));
      return created(await call("POST", "/api/stores", { name: "Milano Centro", ...input, chainId }));
    },
    async product(input: Partial<ProductInput> = {}) {
      return created(await call("POST", "/api/products", { name: "Banane", unit: "g", ...input }));
    },
    async receipt(input: Partial<ReceiptInput> & Pick<ReceiptInput, "storeId" | "items">) {
      return created(await call("POST", "/api/receipts", { date: "2026-10-01", ...input }));
    },
  };
  return api;
}

function created(res: TestResponse): number {
  if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  return (res.body as { id: number }).id;
}
