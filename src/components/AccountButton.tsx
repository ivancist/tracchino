import { useState } from "react";
import { useMe } from "../queries";
import { Dialog, QueryState } from "./ui";

/** Account icon at the top right of "Altro": opens who is signed in and whether the database answers. */
export function AccountButton() {
  const [open, setOpen] = useState(false);
  const me = useMe();
  return (
    <>
      <button type="button" className="icon-button account-button" aria-label="Account" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8.5" r="3.75" />
          <path d="M4.75 19.5c1.2-3.3 4-5 7.25-5s6.05 1.7 7.25 5" strokeLinecap="round" />
        </svg>
      </button>
      <Dialog open={open} title="Account" onClose={() => setOpen(false)}>
        <QueryState isLoading={me.isLoading} error={me.error} />
        {me.data && (
          <dl>
            <dt>Accesso con</dt>
            <dd data-testid="me-email">{me.data.email}</dd>
            <dt>Database</dt>
            <dd data-testid="me-db">{me.data.db === "ok" ? "Connesso" : "Errore"}</dd>
          </dl>
        )}
      </Dialog>
    </>
  );
}
