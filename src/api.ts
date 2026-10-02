export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (res.status === 401) throw new ApiError(401, "Sessione scaduta: ricarica la pagina per accedere di nuovo");
  if (!res.ok) throw new ApiError(res.status, `Richiesta fallita (${res.status})`);
  return (await res.json()) as T;
}
