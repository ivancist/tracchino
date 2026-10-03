import { useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { ReceiptSummary } from "../../shared/api";
import { formatIsoDate } from "../../shared/dates";
import { formatCents } from "../../shared/money";
import { ErrorText, PageHeader, QueryState } from "../components/ui";
import { compressReceiptPhoto } from "../image";
import { scanReceipt, setPendingScan, useReceipts } from "../queries";

function groupByDate(receipts: ReceiptSummary[]) {
  const groups = new Map<string, ReceiptSummary[]>();
  for (const r of receipts) groups.set(r.date, [...(groups.get(r.date) ?? []), r]);
  return [...groups.entries()];
}

/** Photo → compressed in the browser → AI scan → review screen (nothing is saved until confirmed there). */
function useScan() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same photo can be picked again after an error
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await compressReceiptPhoto(file);
      const result = await scanReceipt(photo);
      setPendingScan({ result, photo, photoUrl: URL.createObjectURL(photo) });
      navigate("/scontrini/scansione");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return { busy, error, onFile };
}

export function ReceiptsPage() {
  const receipts = useReceipts();
  const all = receipts.data?.pages.flat();
  const scan = useScan();

  return (
    <>
      <PageHeader
        title="Scontrini"
        action={
          <div className="actions">
            <label className={scan.busy ? "button disabled" : "button"}>
              {scan.busy ? "Lettura…" : "📷 Scansiona"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                disabled={scan.busy}
                aria-label="Foto dello scontrino"
                onChange={scan.onFile}
              />
            </label>
            <Link to="/scontrini/nuovo" className="button primary">
              + Nuovo
            </Link>
          </div>
        }
      />
      {scan.busy && <p className="muted" role="status">Sto leggendo lo scontrino, può richiedere una ventina di secondi…</p>}
      <ErrorText error={scan.error} />
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
