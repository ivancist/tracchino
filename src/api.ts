import type { ApiErrorBody } from "../shared/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: ApiErrorBody,
  ) {
    super(message);
  }
}

/** The Access session expired: the edge answers with a redirect to the login page instead of JSON. */
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, "Sessione scaduta: ricarica la pagina per accedere di nuovo");
  }
}

const sessionListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void) {
  sessionListeners.add(listener);
  return () => void sessionListeners.delete(listener);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  // Images go as raw bytes with their own type; everything else as JSON.
  const isBlob = body instanceof Blob;
  try {
    res = await fetch(path, {
      method,
      // Don't follow Access's cross-origin redirect to the Google login: detect it instead.
      redirect: "manual",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": isBlob ? body.type : "application/json" } : {}),
      },
      body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Connessione assente o server non raggiungibile");
  }

  if (res.type === "opaqueredirect" || res.status === 401) {
    sessionListeners.forEach((l) => l());
    throw new SessionExpiredError();
  }
  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    throw new ApiError(res.status, err?.message ?? `Richiesta fallita (${res.status})`, err ?? undefined);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: (path: string) => request<void>("DELETE", path),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Errore sconosciuto";
}
