import { useState } from "react";
import { useSearchParams } from "react-router";
import type { PantryItem, Product, ShoppingListItem } from "../../shared/api";
import { daysBetween, formatShortDate, todayRome } from "../../shared/dates";
import { MIN_RATE_DAYS } from "../../shared/pantry";
import { formatCents } from "../../shared/money";
import { formatAmount } from "../../shared/quantity";
import { ProductPicker } from "../components/ProductPicker";
import { ErrorText, PageHeader, QueryState } from "../components/ui";
import { costLabel, storedCost } from "../costPreference";
import { formatNumber } from "../format";
import { useAddShoppingItem, useDeleteShoppingItem, usePantry, useProducts, useShoppingList, useUpdateShoppingItem } from "../queries";

type Urgency = NonNullable<NonNullable<PantryItem["forecast"]>["urgency"]>;
const URGENCY: { id: Urgency; title: string }[] = [
  { id: "finished", title: "Finiti" },
  { id: "soon", title: "Finiscono entro 2 giorni" },
  { id: "week", title: "Finiscono entro una settimana" },
];

const label = (p: { name: string; brand: string | null }) => (p.brand ? `${p.name} (${p.brand})` : p.name);
const amount = (g: number, unit: PantryItem["unit"] | null) => formatAmount(Math.round(g), unit ?? "g");

/** "domani (4 ott)", "tra 6 giorni (9 ott)" */
function when(date: string): string {
  const d = daysBetween(todayRome(), date);
  const rel = d <= 0 ? "oggi" : d === 1 ? "domani" : `tra ${d} giorni`;
  return `${rel} (${formatShortDate(date)})`;
}

/** "Restano ≈ 200 g · finisce domani (4 ott)" */
function stockText(item: PantryItem): string {
  if (!item.stock) return "Scorta sconosciuta: non risulta comprato nell'app (o la quantità comprata non è nota)";
  if (item.stock.amount <= 0) return "Finito";
  const left = `Restano ${item.stock.estimated ? "≈ " : ""}${amount(item.stock.amount, item.unit)}`;
  return item.forecast ? `${left} · finisce ${when(item.forecast.runOutDate)}` : left;
}

/** "200 g al giorno · 1 confezione ogni 5 giorni · 6 al mese · 26,40 € al mese" */
function consumptionText(item: PantryItem): string {
  if (item.rateDays < MIN_RATE_DAYS) {
    const days = item.rateDays === 1 ? "1 giorno" : `${item.rateDays} giorni`;
    return `Diario di ${days} da quando l'hai mangiato: per consumi e previsioni ne servono almeno ${MIN_RATE_DAYS}`;
  }
  return [
    `${amount(item.perDay, item.unit)} al giorno`,
    item.packageEveryDays != null && `1 confezione ogni ${formatNumber(item.packageEveryDays)} giorni`,
    item.packagesPerMonth != null && `${formatNumber(item.packagesPerMonth)} al mese`,
    item.costPerMonthCents != null ? `${item.costEstimated ? "≈ " : ""}${formatCents(item.costPerMonthCents)} al mese` : "costo n.d.",
  ]
    .filter(Boolean)
    .join(" · ");
}

function Packages({ value, onChange, name }: { value: number | null; onChange: (v: number | null) => void; name: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const commit = () => {
    const n = text.trim() === "" ? null : Number(text);
    if (n === null || (Number.isInteger(n) && n >= 1 && n <= 99)) {
      if (n !== value) onChange(n);
    } else setText(value == null ? "" : String(value));
  };
  return (
    <input
      className="input packages-input"
      inputMode="numeric"
      aria-label={`Confezioni di ${name}`}
      placeholder="conf."
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function Suggestion({ item }: { item: PantryItem }) {
  const add = useAddShoppingItem();
  const [packages, setPackages] = useState(item.suggestedPackages);
  return (
    <li className="shopping-row" data-testid="suggestion">
      <div className="shopping-main">
        <strong>{label(item)}</strong>
        <div className="muted small">{stockText(item)}</div>
      </div>
      {item.packageAmount != null && <Packages value={packages} onChange={setPackages} name={label(item)} />}
      <button
        type="button"
        className="button"
        disabled={add.isPending}
        onClick={() => add.mutate({ productId: item.productId, packages: item.packageAmount != null ? packages : null })}
      >
        + Aggiungi
      </button>
    </li>
  );
}

function ListRow({ item }: { item: ShoppingListItem }) {
  const update = useUpdateShoppingItem();
  const remove = useDeleteShoppingItem();
  return (
    <li className="shopping-row" data-testid="shopping-item">
      <div className="shopping-main">
        <strong>{label(item)}</strong>
        {item.packageAmount != null && <div className="muted small">confezione da {amount(item.packageAmount, item.unit)}</div>}
      </div>
      {item.productId != null && (
        <Packages key={item.packages ?? "none"} value={item.packages} onChange={(packages) => update.mutate({ id: item.id, packages })} name={label(item)} />
      )}
      <button type="button" className="icon-button" aria-label={`Preso: ${label(item)}`} disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>
        ✓
      </button>
    </li>
  );
}

function AddItem({ products }: { products: Product[] }) {
  const add = useAddShoppingItem();
  const [text, setText] = useState("");
  return (
    <div className="card">
      <ProductPicker label="Aggiungi un prodotto" products={products} value={null} onSelect={(p) => add.mutate({ productId: p.id })} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate({ name: text }, { onSuccess: () => setText("") });
        }}
      >
        <input className="input" aria-label="Altro da comprare" placeholder="Altro (es. candele)" value={text} onChange={(e) => setText(e.target.value)} maxLength={120} />
        <button type="submit" className="button" disabled={!text.trim() || add.isPending}>
          Aggiungi
        </button>
      </form>
      {add.error && <ErrorText error={add.error} />}
    </div>
  );
}

export function ShoppingPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("vista") === "scorte" ? "scorte" : "lista";
  const [cost] = useState(storedCost);
  const pantry = usePantry(cost.mode, cost.windowDays);
  const list = useShoppingList();
  const products = useProducts();
  const suggestions = (pantry.data ?? []).filter((i) => i.forecast?.urgency != null && !i.inList);

  return (
    <>
      <PageHeader title="Lista della spesa" />
      <div className="segmented tabs" role="tablist" aria-label="Vista">
        <button type="button" role="tab" aria-selected={view === "lista"} onClick={() => setParams({})}>
          Lista
        </button>
        <button type="button" role="tab" aria-selected={view === "scorte"} onClick={() => setParams({ vista: "scorte" })}>
          Scorte e consumi
        </button>
      </div>

      {view === "lista" ? (
        <>
          <section aria-labelledby="to-buy">
            <h2 id="to-buy">Da comprare</h2>
            <QueryState isLoading={list.isLoading} error={list.error} />
            {list.data?.length === 0 && <p className="muted">La lista è vuota.</p>}
            <ul className="shopping-list">
              {list.data?.map((item) => <ListRow key={item.id} item={item} />)}
            </ul>
            {products.data && <AddItem products={products.data} />}
            <p className="muted small">Salvando uno scontrino, i prodotti comprati (anche di un'altra marca dello stesso gruppo) escono dalla lista.</p>
          </section>

          <section aria-labelledby="suggested">
            <h2 id="suggested">Suggeriti</h2>
            <QueryState isLoading={pantry.isLoading} error={pantry.error} />
            {pantry.data && suggestions.length === 0 && <p className="muted">Niente sta per finire, secondo il diario degli ultimi 30 giorni.</p>}
            {URGENCY.map((u) => {
              const group = suggestions.filter((s) => s.forecast!.urgency === u.id);
              return (
                group.length > 0 && (
                  <div key={u.id} data-testid={`urgency-${u.id}`}>
                    <h3 className="small">{u.title}</h3>
                    <ul className="shopping-list">
                      {group.map((item) => <Suggestion key={item.productId} item={item} />)}
                    </ul>
                  </div>
                )
              );
            })}
          </section>
        </>
      ) : (
        <section aria-label="Scorte e consumi">
          <QueryState isLoading={pantry.isLoading} error={pantry.error} />
          {pantry.data?.length === 0 && <p className="muted">Nessun prodotto nel diario degli ultimi 30 giorni.</p>}
          <ul className="shopping-list">
            {pantry.data?.map((item) => (
              <li key={item.productId} className="shopping-row" data-testid="pantry-item">
                <div className="shopping-main">
                  <strong>{label(item)}</strong>
                  <div className="small">{stockText(item)}</div>
                  <div className="muted small">{consumptionText(item)}</div>
                </div>
              </li>
            ))}
          </ul>
          <details className="details">
            <summary>Come è calcolato</summary>
            <p className="small">
              Scorta: acquisti registrati nell'app meno quello che hai mangiato da allora, secondo il diario. Consumo: grammi mangiati negli ultimi 30
              giorni diviso i giorni con il diario compilato, dalla prima volta che l'hai mangiato (almeno {MIN_RATE_DAYS} giorni). Costo al mese (30
              giorni): {costLabel(cost)}, come nel diario.
            </p>
          </details>
        </section>
      )}
    </>
  );
}
