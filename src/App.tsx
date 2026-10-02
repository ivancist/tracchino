import { useEffect, useState } from "react";
import type { MeResponse } from "../shared/api";
import { apiGet } from "./api";

type State =
  | { status: "loading" }
  | { status: "ok"; me: MeResponse }
  | { status: "error"; message: string };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    apiGet<MeResponse>("/api/me")
      .then((me) => setState({ status: "ok", me }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof Error ? err.message : "Errore sconosciuto" }),
      );
  }, []);

  return (
    <main className="page">
      <h1>Tracchino</h1>
      <section className="card" aria-live="polite">
        <h2>Chi sono</h2>
        {state.status === "loading" && <p>Caricamento…</p>}
        {state.status === "error" && <p className="error">Errore: {state.message}</p>}
        {state.status === "ok" && (
          <dl>
            <dt>Account</dt>
            <dd data-testid="me-email">{state.me.email}</dd>
            <dt>Database</dt>
            <dd data-testid="me-db">{state.me.db === "ok" ? "Connesso" : "Errore"}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
