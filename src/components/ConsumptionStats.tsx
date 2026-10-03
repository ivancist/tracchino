import { useState } from "react";
import { Link } from "react-router";
import { formatCents } from "../../shared/money";
import { storedCost, costLabel } from "../costPreference";
import { consumptionText, frequencyText, productTitle } from "../pantryText";
import { usePantry } from "../queries";
import { QueryState } from "./ui";

/** Statistiche → Consumi: what is eaten, how often, how many packages and how much it costs a month (last 30 days). */
export function ConsumptionStats() {
  const [cost] = useState(storedCost);
  const pantry = usePantry(cost.mode, cost.windowDays);
  const eaten = (pantry.data ?? [])
    .filter((i) => i.rate != null)
    .sort((a, b) => b.rate!.eatenDays - a.rate!.eatenDays || (b.costPerMonthCents ?? -1) - (a.costPerMonthCents ?? -1));
  const known = eaten.filter((i) => i.costPerMonthCents != null);
  const monthly = known.reduce((s, i) => s + i.costPerMonthCents!, 0);

  return (
    <>
      <p className="muted small">Ultimi 30 giorni, sui giorni con il diario compilato.</p>
      <QueryState isLoading={pantry.isLoading} error={pantry.error} />
      {pantry.data && eaten.length === 0 && <p className="muted">Nessun prodotto nel diario degli ultimi 30 giorni.</p>}
      {known.length > 0 && (
        <div className="tiles">
          <div className="tile hero">
            <div className="tile-label">Al mese, ai consumi attuali</div>
            <div className="tile-value" data-testid="monthly-total">
              {known.length < eaten.length ? "≥ " : ""}
              {formatCents(monthly)}
            </div>
            {known.length < eaten.length && <div className="tile-label">{eaten.length - known.length} prodotti senza costo o con pochi giorni di diario</div>}
          </div>
        </div>
      )}
      <ul className="shopping-list">
        {eaten.map((item) => (
          <li key={item.productId} className="shopping-row" data-testid="consumption-item">
            <div className="shopping-main">
              <Link to={`/prodotti/${item.productId}`} className="inline-link">
                <strong>{productTitle(item)}</strong>
              </Link>
              <div className="small">{frequencyText(item)}</div>
              <div className="muted small">{consumptionText(item)}</div>
            </div>
          </li>
        ))}
      </ul>
      <details className="details">
        <summary>Come è calcolato</summary>
        <p className="small">
          Consumo: grammi mangiati negli ultimi 30 giorni diviso i giorni con il diario compilato, dalla prima volta che l'hai mangiato (servono
          almeno 3 giorni). Costo al mese (30 giorni): {costLabel(cost)}, come nel diario.
        </p>
      </details>
    </>
  );
}
