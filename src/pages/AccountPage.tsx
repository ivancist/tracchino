import { Link } from "react-router";
import { PageHeader, QueryState } from "../components/ui";
import { useMe } from "../queries";

export function AccountPage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Altro" />
      <ul className="list">
        <li>
          <Link to="/negozi" className="list-item">
            <span>
              <strong>Negozi e catene</strong>
              <br />
              <span className="muted small">Punti vendita, P.IVA per riconoscerli dagli scontrini</span>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        </li>
      </ul>
      <section className="card" aria-live="polite">
        <h2>Chi sono</h2>
        <QueryState isLoading={me.isLoading} error={me.error} />
        {me.data && (
          <dl>
            <dt>Account</dt>
            <dd data-testid="me-email">{me.data.email}</dd>
            <dt>Database</dt>
            <dd data-testid="me-db">{me.data.db === "ok" ? "Connesso" : "Errore"}</dd>
          </dl>
        )}
      </section>
    </>
  );
}
