import { PageHeader, QueryState } from "../components/ui";
import { useMe } from "../queries";

export function AccountPage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Account" />
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
