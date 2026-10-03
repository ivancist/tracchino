import { useMemo, useState, type FormEvent } from "react";
import type { PastMeal, PastMealItem, Product } from "../../shared/api";
import { formatIsoDate } from "../../shared/dates";
import { MEAL_LABELS, portionAmount, type Meal } from "../../shared/diary";
import { formatAmount, parseAmount } from "../../shared/quantity";
import { diaryBatchInput } from "../../shared/schemas";
import { formatNumber, parseDecimalInput } from "../format";
import { useAddDiaryBatch, useProducts, useRecentMeals } from "../queries";
import { ProductPicker, productLabel } from "./ProductPicker";
import { ErrorText, Field, QueryState } from "./ui";

/** A line of the meal being repeated: kept or dropped, same or another product, same or another quantity. */
type Line = {
  key: number;
  original: PastMealItem;
  include: boolean;
  productId: number;
  /** Portions belong to a product: they stay usable only while the product is unchanged. */
  usePortion: boolean;
  amountText: string;
  qtyText: string;
};

const linesFrom = (meal: PastMeal): Line[] =>
  meal.items.map((item, i) => ({
    key: i,
    original: item,
    include: true,
    productId: item.productId,
    usePortion: item.portionId != null,
    amountText: String(item.amount),
    qtyText: item.portionQty != null ? formatNumber(item.portionQty, 2) : "1",
  }));

const unitOf = (p: { unit: string }) => (p.unit === "ml" ? "ml" : "g");

function itemText(i: PastMealItem): string {
  const amount = formatAmount(i.amount, unitOf(i));
  return i.portionName && i.portionQty != null ? `${formatNumber(i.portionQty, 2)} × ${i.portionName}` : amount;
}

function mealSummary(m: PastMeal): string {
  return m.items.map((i) => `${i.productName} ${itemText(i)}`).join(", ");
}

/** Pick a past meal of the same kind, adjust it (brand, quantities, drop items), add it to the day in one go. */
export function RepeatMealForm({ date, meal, onDone }: { date: string; meal: Meal; onDone: () => void }) {
  const recent = useRecentMeals(meal, date);
  const products = useProducts();
  const add = useAddDiaryBatch();
  const [chosen, setChosen] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<unknown>(null);

  const productById = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);

  function choose(index: number) {
    setChosen(index);
    setLines(linesFrom(recent.data![index]!));
    setError(null);
  }
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function changeProduct(line: Line, product: Product) {
    const same = product.id === line.original.productId;
    // Another product: the old portion doesn't apply, start from the same grams.
    update(line.key, {
      productId: product.id,
      usePortion: same && line.original.portionId != null,
      amountText: String(line.original.amount),
    });
  }

  const included = lines.filter((l) => l.include);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const entries = [];
    for (const l of included) {
      const product = productById.get(l.productId);
      if (!product) return setError("Prodotto non trovato");
      if (l.usePortion) {
        const qty = parseDecimalInput(l.qtyText);
        if (qty == null || qty <= 0) return setError(`${product.name}: numero di porzioni non valido`);
        entries.push({ date, meal, productId: l.productId, portionId: l.original.portionId, portionQty: qty });
      } else {
        const amount = parseAmount(l.amountText, unitOf(product));
        if (!amount) return setError(`${product.name}: quantità non valida`);
        entries.push({ date, meal, productId: l.productId, amount });
      }
    }
    const check = diaryBatchInput.safeParse({ entries });
    if (!check.success) return setError(check.error.issues[0]?.message ?? "Dati non validi");
    try {
      await add.mutateAsync({ entries });
      onDone();
    } catch (err) {
      setError(err);
    }
  }

  if (recent.isLoading || products.isLoading || recent.error) {
    return <QueryState isLoading={recent.isLoading || products.isLoading} error={recent.error} />;
  }
  if (!recent.data?.length) {
    return <p className="muted">Nessun {MEAL_LABELS[meal].toLowerCase()} nei giorni precedenti da ripetere.</p>;
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <fieldset className="choices">
        <legend className="field-label">Quale {MEAL_LABELS[meal].toLowerCase()}?</legend>
        {recent.data.map((m, i) => (
          <label key={m.dates[0]} className={chosen === i ? "choice selected" : "choice"} data-testid="past-meal">
            <input type="radio" name="past-meal" checked={chosen === i} onChange={() => choose(i)} />
            <span>
              <strong>
                {m.dates.length > 1 ? `Uguale in ${m.dates.length} giorni` : "Una volta"} · ultima {formatIsoDate(m.dates[0]!)}
              </strong>
              <br />
              <span className="muted small">{mealSummary(m)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {chosen != null && (
        <>
          <h3 className="field-label">Modifica prima di aggiungere</h3>
          <ul className="lines">
            {lines.map((l, index) => {
              const product = productById.get(l.productId);
              const groupId = productById.get(l.original.productId)?.groupId ?? l.original.groupId;
              // Same group first (other brands of the same thing), then what's bought most.
              const maxBought = Math.max(1, ...(products.data ?? []).map((p) => p.purchaseCount));
              const boost = (p: Product) => (groupId != null && p.groupId === groupId ? 1 : 0.3 * (p.purchaseCount / maxBought));
              return (
                <li key={l.key} className={l.include ? "line" : "line excluded"} data-testid="repeat-line">
                  <label className="check">
                    <input type="checkbox" checked={l.include} onChange={(e) => update(l.key, { include: e.target.checked })} />
                    Includi {l.original.productName}
                  </label>
                  {l.include && (
                    <>
                      <ProductPicker
                        label={`Prodotto ${index + 1}`}
                        products={products.data ?? []}
                        value={product ?? null}
                        boost={boost}
                        onSelect={(p) => changeProduct(l, p)}
                      />
                      {l.usePortion ? (
                        <Field label={`Quante porzioni (${l.original.portionName ?? "porzione"})`}>
                          <input
                            className="input"
                            inputMode="decimal"
                            value={l.qtyText}
                            onChange={(e) => update(l.key, { qtyText: e.target.value })}
                          />
                        </Field>
                      ) : (
                        <Field label={product?.unit === "ml" ? `Quantità ${index + 1} (ml)` : `Peso ${index + 1} (g)`}>
                          <input
                            className="input"
                            inputMode="decimal"
                            value={l.amountText}
                            onChange={(e) => update(l.key, { amountText: e.target.value })}
                          />
                        </Field>
                      )}
                      {l.usePortion && l.original.portionId != null && parseDecimalInput(l.qtyText) != null && (
                        <p className="muted small">
                          ≈ {formatAmount(portionAmount(l.original.amount / (l.original.portionQty ?? 1), parseDecimalInput(l.qtyText)!), unitOf(l.original))}
                        </p>
                      )}
                      {product && product.id !== l.original.productId && (
                        <p className="muted small">al posto di {productLabel({ name: l.original.productName, brand: l.original.productBrand })}</p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ErrorText error={error} />
      <div className="actions">
        <button type="submit" className="button primary" disabled={chosen == null || included.length === 0 || add.isPending}>
          {add.isPending
            ? "Salvataggio…"
            : `Aggiungi ${included.length} ${included.length === 1 ? "voce" : "voci"} a ${MEAL_LABELS[meal].toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
