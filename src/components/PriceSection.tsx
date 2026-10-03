import { useState } from "react";
import type { PriceStats, Product, PurchaseRow } from "../../shared/api";
import { formatIsoDate, formatShortDate } from "../../shared/dates";
import { formatCents } from "../../shared/money";
import { unitPrices } from "../../shared/pricing";
import { formatAmount, formatPackagesPieces, perKiloSuffix } from "../../shared/quantity";
import type { StorePriceStats } from "../../shared/stats";
import { usePriceStats } from "../queries";
import { DotChart } from "./charts";
import { QueryState } from "./ui";

type Metric = PriceStats["metric"];

/** Value of a store on the ranking metric only (the other metric, if any, is shown as secondary text). */
function storeValue(s: StorePriceStats, metric: Metric, suffix: string) {
  if (metric === "kilo") {
    return s.perKilo ? { cents: s.perKilo.cents, text: `${s.perKilo.estimated ? "≈ " : ""}${formatCents(s.perKilo.cents)}${suffix}` } : null;
  }
  return s.perPiece ? { cents: s.perPiece.cents, text: `${formatCents(s.perPiece.cents)}/pz` } : null;
}

function lineUnitPrice(p: PurchaseRow, metric: Metric, volume: boolean) {
  const u = unitPrices(p, p);
  if (metric === "piece") return u.perPiece != null ? { cents: u.perPiece, estimated: false } : null;
  if ((p.unit === "ml") !== volume || !u.perKilo) return null; // other unit family: not comparable
  return { cents: u.perKilo.cents, estimated: u.perKilo.source === "estimated" };
}

export function PriceSection({ product }: { product: Product }) {
  const [scope, setScope] = useState<"product" | "group">("product");
  const isGroup = scope === "group" && product.groupId != null;
  const stats = usePriceStats(isGroup ? "groups" : "products", isGroup ? product.groupId : product.id);
  const data = stats.data;
  const metric: Metric = data?.metric ?? "kilo";
  const suffix = metric === "piece" ? "/pz" : perKiloSuffix(data?.volume ? "ml" : "g");

  const values = data?.byStore.map((s) => storeValue(s, metric, suffix)) ?? [];
  const maxValue = Math.max(1, ...values.map((v) => v?.cents ?? 0));

  // Chart: max 3 series (palette validated all-pairs for 3): always the cheapest store, then the most visited.
  const cheapest = data?.byStore[0];
  const byVisits = [...(data?.byStore ?? [])].sort((a, b) => b.purchases - a.purchases);
  const storeOrder = cheapest
    ? [cheapest, ...byVisits.filter((st) => st.storeId !== cheapest.storeId)].slice(0, 3)
    : [];
  const seriesOf = new Map(storeOrder.map((s, i) => [s.storeId, i]));
  const dots = (data?.purchases ?? []).flatMap((p) => {
    const series = seriesOf.get(p.storeId);
    const price = lineUnitPrice(p, metric, data!.volume);
    if (series == null || !price) return [];
    return [{
      key: `${p.receiptId}-${p.productId}-${p.date}-${p.pricePaidCents}`,
      date: p.date,
      value: price.cents,
      series,
      tooltip: `${formatShortDate(p.date)} · ${p.chainName} · ${price.estimated ? "≈ " : ""}${formatCents(price.cents)}${suffix}`,
    }];
  });

  return (
    <section className="card" data-testid="price-section">
      <h2>Prezzi e negozi</h2>
      {product.groupId != null && (
        <div className="chips wrap" role="group" aria-label="Confronta">
          <button type="button" className="chip" aria-pressed={!isGroup} onClick={() => setScope("product")}>
            Questo prodotto
          </button>
          <button type="button" className="chip" aria-pressed={isGroup} onClick={() => setScope("group")}>
            Tutto il gruppo «{product.groupName}»
          </button>
        </div>
      )}
      <QueryState isLoading={stats.isLoading} error={stats.error} />
      {data && data.purchases.length === 0 && <p className="muted">Nessun acquisto ancora.</p>}
      {data && data.purchases.length > 0 && (
        <>
          <p className="muted small">
            Comprato {data.frequency.purchases} {data.frequency.purchases === 1 ? "volta" : "volte"}
            {data.frequency.avgIntervalDays != null && `, circa ogni ${Math.round(data.frequency.avgIntervalDays)} giorni`}
            {data.frequency.lastDate && ` · ultimo ${formatIsoDate(data.frequency.lastDate)}`}
          </p>

          <ul className="list" data-testid="store-comparison">
            {data.byStore.map((s, i) => {
              const v = values[i];
              return (
                <li key={s.storeId} className="rank-row">
                  <span className="rank-top">
                    <span>
                      <strong>{s.chainName}</strong> <span className="muted">{s.storeName}</span>
                      {i === 0 && v && data.byStore.length > 1 && <span className="badge">più conveniente</span>}
                    </span>
                    <strong>{v?.text ?? "—"}</strong>
                  </span>
                  <span className="muted small">
                    {s.purchases === 1 ? "1 acquisto" : `${s.purchases} acquisti`} · ultimo {formatShortDate(s.lastDate)} a {formatCents(s.lastPaidCents)}
                  </span>
                  {v && <div className="rowbar" style={{ width: `${(v.cents / maxValue) * 100}%` }} aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
          {data.byStore.some((s) => s.perKilo?.estimated) && (
            <p className="muted small">≈ = quantità stimata dal peso medio o da una confezione presunta.</p>
          )}

          <div style={{ marginTop: "1rem" }}>
            <DotChart
              title={`Prezzo ${suffix === "/pz" ? "al pezzo" : suffix === "/l" ? "al litro" : "al kg"} nel tempo`}
              dots={dots}
              series={storeOrder.map((s) => s.chainName + (storeOrder.filter((o) => o.chainName === s.chainName).length > 1 ? ` ${s.storeName}` : ""))}
              format={(c) => formatCents(c)}
            />
            {data.byStore.length > 3 && (
              <p className="muted small">Nel grafico il negozio più conveniente e i più frequenti (max 3); gli altri sono nell'elenco sopra.</p>
            )}
            {data.truncated && <p className="muted small">Analizzati gli acquisti più recenti.</p>}
          </div>

          <details className="details">
            <summary>Tutti gli acquisti ({data.purchases.length})</summary>
            <div className="chart-table">
              <table className="table">
                <tbody>
                  {data.purchases.map((p) => {
                    const price = lineUnitPrice(p, metric, data.volume);
                    const qty = [formatPackagesPieces(p) || null, p.amount != null ? formatAmount(p.amount, p.unit === "ml" ? "ml" : "g") : null]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={`${p.receiptId}-${p.productId}-${p.pricePaidCents}-${p.date}`}>
                        <td>
                          {formatShortDate(p.date)} · {p.chainName}
                          {isGroup && <div className="muted small">{p.productName}</div>}
                          {qty && <div className="muted small">{qty}</div>}
                        </td>
                        <td className="num">
                          {formatCents(p.pricePaidCents)}
                          {price && (
                            <div className="muted small">
                              {price.estimated ? "≈ " : ""}
                              {formatCents(price.cents)}
                              {suffix}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
