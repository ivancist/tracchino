import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { ApiErrorBody } from "../shared/api";
import { idParam } from "../shared/schemas";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: ApiErrorBody,
  ) {
    super(body.message ?? body.error);
  }
}

export const notFound = (message = "Non trovato") => new HttpError(404, { error: "not_found", message });

function invalid(error: z.ZodError): HttpError {
  return new HttpError(400, {
    error: "invalid_input",
    message: error.issues[0]?.message ?? "Dati non validi",
    issues: error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)), message: i.message })),
  });
}

export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Parses and validates the JSON body; throws 400 with Zod issues on failure.
 * Requires `Content-Type: application/json` (415 otherwise): browsers can only send that cross-site after a
 * CORS preflight, which this API never grants — a CSRF guard on top of the Origin check in `sameOriginOnly`.
 */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const type = c.req.header("Content-Type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new HttpError(415, { error: "invalid_input", message: "Content-Type deve essere application/json" });
  }
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, { error: "invalid_input", message: "Richiesta troppo grande" });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(400, { error: "invalid_input", message: "JSON non valido" });
  }
  const result = schema.safeParse(json);
  if (!result.success) throw invalid(result.error);
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw invalid(result.error);
  return result.data;
}

/** Validates the `:id` path parameter (positive integer), 400 otherwise. */
export function parseId(c: Context, name = "id"): number {
  const result = idParam.safeParse(c.req.param(name));
  if (!result.success) throw new HttpError(400, { error: "invalid_input", message: `Parametro ${name} non valido` });
  return result.data;
}

/** Translates D1/SQLite constraint failures into 4xx responses; anything else stays a 500. */
export function toHttpError(err: unknown): HttpError | null {
  if (err instanceof HttpError) return err;
  const message = collectMessages(err);
  if (message.includes("UNIQUE constraint failed")) {
    return new HttpError(409, { error: "conflict", message: "Esiste già un elemento con questi dati" });
  }
  if (message.includes("FOREIGN KEY constraint failed")) {
    return new HttpError(409, { error: "in_use", message: "Elemento collegato ad altri dati o riferimento inesistente" });
  }
  if (message.includes("CHECK constraint failed")) {
    return new HttpError(400, { error: "invalid_input", message: "Dati non validi" });
  }
  return null;
}

// Drizzle wraps D1 errors: the constraint text can be in `cause`.
function collectMessages(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else break;
  }
  return parts.join(" | ");
}
