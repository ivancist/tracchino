import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Product, ProductAnalysis, SimulationResult } from "../../shared/api";
import type { Measure } from "../../shared/analysis";
import { formatIsoDate } from "../../shared/dates";
import { formatCents } from "../../shared/money";
import { formatAmount } from "../../shared/quantity";
import { costLabel, storedCost } from "../costPreference";
import { formatDerivedCents, formatNumber, parseDecimalInput } from "../format";
import { useDietAnalysis, useProducts, useSimulation, type SimulationParams } from "../queries";
import { ProductPicker, productLabel } from "./ProductPicker";
import { ErrorText, Field, QueryState } from "./ui";

const money = (cents: number | null) => (cents == null ? "n.d." : formatCents(Math.round(cents)));
const unitMoney = (cents: number | null) => (cents == null ? "n.d." : formatDerivedCents(cents));
const size = (p: { unit: string }, amount: number) => formatAmount(amount, p.unit === "ml" ? "ml" : "g");

type Sort = "eaten" | "kcal" | "protein";
const SORTS: { id: Sort; label: string }[] = [
  { id: "eaten", label: "Più mangiati" },
  { id: "kcal", label: "€ per 100 kcal" },
  { id: "protein", label: "€ per 10 g proteine" },
];

/** Unknown values go last whatever the order. */
function sortProducts(list: ProductAnalysis[], sort: Sort) {
  if (sort === "eaten") return list;
  const key = (p: ProductAnalysis) => (sort === "kcal" ? p.per100KcalCents : p.per10gProteinCents);
  return [...list].sort((a, b) => (key(a) ?? Infinity) - (key(b) ?? Infinity));
}

const MEASURE_LABELS: Record<Measure, string> = {
  cost: "Costo",
  kcal: "Energia",
  protein: "Proteine",
  fat: "Grassi",
  saturatedFat: "di cui saturi",
  carbs: "Carboidrati",
  sugars: "Zuccheri",
  fiber: "Fibre",
  salt: "Sale",
};

function measureText(m: Measure, v: number | null, signed = false): string {
  if (v == null) return "n.d.";
  const sign = signed && v > 0 ? "+" : "";
  if (m === "cost") return `${sign}${formatCents(Math.round(v))}`;
  if (m === "kcal") return `${sign}${formatNumber(v, 0)} kcal`;
  if (m === "salt") return `${sign}${formatNumber(v, 2)} g`;
  return `${sign}${formatNumber(v)} g`;
}

function SimulationView({ result }: { result: SimulationResult }) {
  if (result.affectedEntries === 0) return <p className="muted">Nel periodo non hai mai segnato questo prodotto nel diario.</p>;
  const perDay = (v: number | null) => (v == null || result.loggedDays === 0 ? null : v / result.loggedDays);
  return (
    <div data-testid="simulation">
      <p className="muted small">
        Su {result.affectedEntries} {result.affectedEntries === 1 ? "voce" : "voci"} in {result.affectedDays}{" "}
        {result.affectedDays === 1 ? "giorno" : "giorni"} ({result.loggedDays} giorni registrati nel periodo).
      </p>
      <ul className="list">
        {(Object.keys(MEASURE_LABELS) as Measure[]).map((m) => (
          <li key={m} className="list-item" data-testid={`sim-${m}`}>
            <span>
              <strong>{MEASURE_LABELS[m]}</strong>
              <br />
              <span className="muted small">
                {measureText(m, result.before[m])} → {measureText(m, result.after[m])}
              </span>
            </span>
            <span className="right">
              <strong>{measureText(m, result.delta[m], true)}</strong>
              {perDay(result.delta[m]) != null && (
                <>
                  <br />
                  <span className="muted small">{measureText(m, perDay(result.delta[m]), true)} al giorno</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Diet side of the stats page: what eating this way costs, product value, and "what if" simulations. */
export function DietAnalysis({ from, to }: { from?: string; to?: string }) {
  const [cost] = useState(storedCost);
  const analysis = useDietAnalysis(from, to, cost.mode, cost.windowDays);
  const products = useProducts();
  const [sort, setSort] = useState<Sort>("eaten");
  const [fromProduct, setFromProduct] = useState<Product | null>(null);
  const [toProduct, setToProduct] = useState<Product | null>(null);
  const [factorText, setFactorText] = useState("1");
  const [params, setParams] = useState<SimulationParams | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const simulation = useSimulation(from, to, cost.mode, cost.windowDays, params);

  const a = analysis.data;
  const eaten = useMemo(
    () => (products.data ?? []).filter((p) => a?.products.some((x) => x.productId === p.id && x.eatenEntries > 0)),
    [products.data, a],
  );

  function runSimulation(e: FormEvent) {
    e.preventDefault();
    const factor = parseDecimalInput(factorText);
    if (!fromProduct) return setFormError("Scegli il prodotto da sostituire");
    if (factor == null || factor <= 0 || factor > 10) return setFormError("Quantità non valida (es. 1, 0,5, 1,5)");
    setFormError(null);
    setParams({ fromProduct: fromProduct.id, toProduct: (toProduct ?? fromProduct).id, factor });
  }

  if (analysis.isLoading || analysis.error) return <QueryState isLoading={analysis.isLoading} error={analysis.error} />;
  if (!a) return null;
  if (a.firstDiaryDate == null) {
    return (
      <div className="empty">
        <p>Le analisi della dieta compaiono dopo le prime voci del diario.</p>
        <Link to="/diario" className="button primary">
          Apri il diario
        </Link>
      </div>
    );
  }
  const s = a.summary;
  return (
    <>
      <p className="muted small">
        {formatIsoDate(a.from)} → {formatIsoDate(a.to)} · {s.days.length} {s.days.length === 1 ? "giorno registrato" : "giorni registrati"}{" "}
        (i giorni senza diario non contano) · costo: {costLabel(cost)}
      </p>
      {a.todayExcluded && (
        <p className="muted small" data-testid="today-excluded">
          Oggi non è ancora nel conto: entra quando hai registrato colazione, pranzo e cena.
        </p>
      )}
      <div className="tiles" data-testid="diet-tiles">
        <div className="tile hero">
          <div className="tile-label">Costo medio al giorno</div>
          <div className="tile-value">{money(s.dailyMean.cost)}</div>
          {s.entriesWithoutCost > 0 && (
            <div className="tile-label">
              {s.entriesWithoutCost === 1 ? "1 voce senza costo esclusa" : `${s.entriesWithoutCost} voci senza costo escluse`}
            </div>
          )}
        </div>
        <div className="tile">
          <div className="tile-label">A settimana (stima)</div>
          <div className="tile-value">{money(s.weeklyCostEstimate)}</div>
          <div className="tile-label">7 × media giornaliera</div>
        </div>
        <div className="tile">
          <div className="tile-label">Energia media</div>
          <div className="tile-value">{s.dailyMean.kcal == null ? "n.d." : `${formatNumber(s.dailyMean.kcal, 0)} kcal`}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Proteine medie</div>
          <div className="tile-value">{s.dailyMean.protein == null ? "n.d." : `${formatNumber(s.dailyMean.protein)} g`}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Costo per 100 kcal</div>
          <div className="tile-value">{unitMoney(s.costPer100Kcal)}</div>
          <div className="tile-label">solo voci con costo e kcal</div>
        </div>
      </div>

      <section className="day">
        <h2 className="day-title">Valore dei prodotti</h2>
        <div className="chips wrap" role="group" aria-label="Ordina per">
          {SORTS.map((o) => (
            <button key={o.id} type="button" className="chip" aria-pressed={sort === o.id} onClick={() => setSort(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <ul className="list" data-testid="product-value">
          {sortProducts(a.products, sort).map((p) => (
            <li key={p.productId} className="list-item" data-testid="product-value-row">
              <span>
                <Link to={`/prodotti/${p.productId}`} className="inline-link">
                  <strong>{productLabel(p)}</strong>
                </Link>
                <br />
                <span className="muted small">
                  {p.eatenEntries > 0
                    ? `mangiato in ${p.eatenDays} ${p.eatenDays === 1 ? "giorno" : "giorni"} su ${s.days.length} (${size(p, p.eatenAmount)})`
                    : "mai nel diario"}
                </span>
              </span>
              <span className="right small value-col">
                <span>
                  <strong>{unitMoney(p.per100KcalCents)}</strong> <span className="muted">/100 kcal</span>
                </span>
                <span>
                  <strong>{unitMoney(p.per10gProteinCents)}</strong> <span className="muted">/10 g prot.</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="sim-title">
        <h2 id="sim-title">Cosa succede se…</h2>
        <p className="muted small">
          Sostituisci un prodotto con un altro (o cambia solo la quantità) in tutte le voci del diario del periodo.
        </p>
        <form className="form" onSubmit={runSimulation}>
          <Field label="Al posto di">
            <select
              className="input"
              value={fromProduct?.id ?? ""}
              onChange={(e) => setFromProduct(eaten.find((p) => p.id === Number(e.target.value)) ?? null)}
            >
              <option value="" disabled>
                {eaten.length ? "Scegli un prodotto del diario…" : "Nessun prodotto nel periodo"}
              </option>
              {eaten.map((p) => (
                <option key={p.id} value={p.id}>
                  {productLabel(p)}
                </option>
              ))}
            </select>
          </Field>
          <ProductPicker
            label="Metti (vuoto = stesso prodotto)"
            products={products.data ?? []}
            value={toProduct}
            onSelect={setToProduct}
          />
          <Field label="Quantità ×" hint="1 = stessi grammi, 0,5 = metà, 1,5 = una volta e mezza">
            <input className="input" inputMode="decimal" value={factorText} onChange={(e) => setFactorText(e.target.value)} />
          </Field>
          <ErrorText error={formError} />
          <div className="actions">
            {toProduct && (
              <button type="button" className="button" onClick={() => setToProduct(null)}>
                Stesso prodotto
              </button>
            )}
            <button type="submit" className="button primary">
              Simula
            </button>
          </div>
        </form>
        <QueryState isLoading={simulation.isFetching && !simulation.data} error={simulation.error} />
        {simulation.data && <SimulationView result={simulation.data} />}
      </section>
    </>
  );
}
