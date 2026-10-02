import { Link } from "react-router";
import type { ReceiptSummary } from "../../shared/api";
import { formatIsoDate } from "../../shared/dates";
import { formatCents } from "../../shared/money";
import { PageHeader, QueryState } from "../components/ui";
import { useReceipts } from "../queries";

function groupByDate(receipts: ReceiptSummary[]) {
  const groups = new Map<string, ReceiptSummary[]>();
  for (const r of receipts) groups.set(r.date, [...(groups.get(r.date) ?? []), r]);
  return [...groups.entries()];
}

export function ReceiptsPage() {
  const receipts = useReceipts();
  const all = receipts.data?.pages.flat();

  return (
    <>
      <PageHeader
        title="Scontrini"
        action={
          <Link to="/scontrini/nuovo" className="button primary">
            + Nuovo
          </Link>
        }
      />
      <QueryState isLoading={receipts.isLoading} error={receipts.error} />
      {all?.length === 0 && (
        <div className="empty">
          <p>Nessuno scontrino ancora.</p>
          <Link to="/scontrini/nuovo" className="button primary">
            Inserisci il primo
          </Link>
        </div>
      )}
      {all &&
        groupByDate(all).map(([date, items]) => (
          <section key={date} className="day">
            <h2 className="day-title">
              <span>{formatIsoDate(date)}</span>
              <span>{formatCents(items.reduce((s, r) => s + r.totalCents, 0))}</span>
            </h2>
            <ul className="list">
              {items.map((r) => (
                <li key={r.id}>
                  <Link to={`/scontrini/${r.id}`} className="list-item" data-testid="receipt-row">
                    <span>
                      <strong>{r.chainName}</strong> <span className="muted">{r.storeName}</span>
                      <br />
                      <span className="muted small">
                        {r.itemCount} {r.itemCount === 1 ? "prodotto" : "prodotti"}
                        {r.totalPrintedCents != null && r.totalPrintedCents !== r.totalCents && " · ⚠ totale diverso dallo scontrino"}
                      </span>
                    </span>
                    <strong data-testid="receipt-row-total">{formatCents(r.totalCents)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {receipts.hasNextPage && (
        <button type="button" className="button wide" disabled={receipts.isFetchingNextPage} onClick={() => receipts.fetchNextPage()}>
          {receipts.isFetchingNextPage ? "Caricamento…" : "Mostra altri"}
        </button>
      )}
    </>
  );
}
