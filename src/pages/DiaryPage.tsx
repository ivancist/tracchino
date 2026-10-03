import { useState } from "react";
import { useSearchParams } from "react-router";
import type { DiaryEntry } from "../../shared/api";
import { addDays, formatIsoDate, isValidIsoDate, todayRome } from "../../shared/dates";
import { COST_WINDOWS, MEAL_LABELS, MEALS, sumKnown, sumNutrients, type CostMode, type Meal, type Nutrient, type Total } from "../../shared/diary";
import { formatCents } from "../../shared/money";
import { formatAmount } from "../../shared/quantity";
import { DiaryEntryForm } from "../components/DiaryEntryForm";
import { RepeatMealForm } from "../components/RepeatMealForm";
import { Dialog, PageHeader, QueryState } from "../components/ui";
import { costLabel, saveCost, storedCost, type CostPref } from "../costPreference";
import { formatNumber } from "../format";
import { useDiaryDay, useFrequentProducts, useProducts } from "../queries";

/** "1.234 kcal", or "n.d." when nothing is known; "≥" when some entries lack the value. */
function totalText(t: Total, format: (v: number) => string): string {
  if (t.value == null) return "n.d.";
  return `${t.missing > 0 ? "≥ " : ""}${format(t.value)}`;
}

function missingHint(t: Total): string | undefined {
  if (t.missing === 0) return undefined;
  return t.missing === 1 ? "1 voce senza dato" : `${t.missing} voci senza dato`;
}

function Tile({ label, total, format, testId }: { label: string; total: Total; format: (v: number) => string; testId: string }) {
  return (
    <div className="tile" data-testid={testId}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{totalText(total, format)}</div>
      {missingHint(total) && <div className="tile-label">{missingHint(total)}</div>}
    </div>
  );
}

const grams = (v: number) => `${formatNumber(v)} g`;

/** "P 12 g · G 3 g (saturi 0,5 g) · C 60 g (zuccheri 5 g) · fibre 4 g · sale 0,05 g": unknown values left out. */
function mealNutrients(t: Record<Nutrient, Total>): string {
  const g = (n: Nutrient, digits = 1) => (t[n].value == null ? null : `${t[n].missing ? "≥ " : ""}${formatNumber(t[n].value!, digits)} g`);
  const part = (label: string, main: string | null, subLabel?: string, sub?: string | null) =>
    main == null ? null : `${label} ${main}${sub ? ` (${subLabel} ${sub})` : ""}`;
  return [
    part("P", g("protein")),
    part("G", g("fat"), "saturi", g("saturatedFat")),
    part("C", g("carbs"), "zuccheri", g("sugars")),
    part("fibre", g("fiber")),
    part("sale", g("salt", 2)),
  ]
    .filter(Boolean)
    .join(" · ");
}

function entryQuantity(e: DiaryEntry): string {
  const unit = e.unit === "ml" ? "ml" : "g";
  const amount = formatAmount(e.amount, unit);
  return e.portionName && e.portionQty != null ? `${formatNumber(e.portionQty, 2)} × ${e.portionName} (${amount})` : amount;
}

export function DiaryPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("data");
  const today = todayRome();
  const date = requested && isValidIsoDate(requested) ? requested : today;
  const [cost, setCost] = useState<CostPref>(storedCost);
  const day = useDiaryDay(date, cost.mode, cost.windowDays);
  // Warm the catalog for the add dialog's autocomplete.
  useProducts();
  useFrequentProducts();
  const [editing, setEditing] = useState<{ meal: Meal; entry?: DiaryEntry } | null>(null);
  const [repeating, setRepeating] = useState<Meal | null>(null);

  const goTo = (d: string) => setParams(d === today ? {} : { data: d });
  function changeCost(patch: Partial<CostPref>) {
    const next = { ...cost, ...patch };
    setCost(next);
    saveCost(next);
  }

  const d = day.data;
  return (
    <>
      <PageHeader title="Diario" />
      <div className="day-nav">
        <button type="button" className="icon-button" aria-label="Giorno precedente" onClick={() => goTo(addDays(date, -1))}>
          ‹
        </button>
        <input
          className="input"
          type="date"
          aria-label="Giorno"
          value={date}
          max={today}
          onChange={(e) => isValidIsoDate(e.target.value) && goTo(e.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          aria-label="Giorno successivo"
          disabled={date >= today}
          onClick={() => goTo(addDays(date, 1))}
        >
          ›
        </button>
      </div>
      <p className="muted small day-label">
        {formatIsoDate(date)}
        {date !== today && (
          <>
            {" · "}
            <button type="button" className="link small" onClick={() => goTo(today)}>
              torna a oggi
            </button>
          </>
        )}
      </p>

      <QueryState isLoading={day.isLoading} error={day.error} />
      {d && (
        <>
          <div className="tiles" data-testid="diary-totals">
            <Tile label="Energia" total={d.totals.kcal} format={(v) => `${formatNumber(v, 0)} kcal`} testId="total-kcal" />
            <Tile label="Costo stimato" total={d.cost} format={formatCents} testId="total-cost" />
            <Tile label="Proteine" total={d.totals.protein} format={grams} testId="total-protein" />
            <Tile label="Grassi" total={d.totals.fat} format={grams} testId="total-fat" />
            <Tile label="di cui saturi" total={d.totals.saturatedFat} format={grams} testId="total-saturated" />
            <Tile label="Carboidrati" total={d.totals.carbs} format={grams} testId="total-carbs" />
            <Tile label="di cui zuccheri" total={d.totals.sugars} format={grams} testId="total-sugars" />
            <Tile label="Fibre" total={d.totals.fiber} format={grams} testId="total-fiber" />
            <Tile label="Sale" total={d.totals.salt} format={(v) => `${formatNumber(v, 2)} g`} testId="total-salt" />
          </div>

          {MEALS.map((meal) => {
            const entries = d.entries.filter((e) => e.meal === meal);
            const totals = sumNutrients(entries.map((e) => e.nutrients));
            const mealCost = sumKnown(entries.map((e) => e.costCents));
            const nutrients = mealNutrients(totals);
            return (
              <section key={meal} className="day" aria-labelledby={`meal-${meal}`} data-testid={`meal-${meal}`}>
                <h2 className="day-title" id={`meal-${meal}`}>
                  <span>{MEAL_LABELS[meal]}</span>
                  {entries.length > 0 && (
                    <span data-testid="meal-head">
                      {totalText(totals.kcal, (v) => `${formatNumber(v, 0)} kcal`)} · {totalText(mealCost, formatCents)}
                    </span>
                  )}
                </h2>
                {entries.length > 0 && nutrients && (
                  <p className="muted small meal-nutrients" data-testid="meal-nutrients">
                    {nutrients}
                  </p>
                )}
                {entries.length > 0 && (
                  <ul className="list">
                    {entries.map((e) => (
                      <li key={e.id}>
                        <button type="button" className="list-item plain" data-testid="diary-entry" onClick={() => setEditing({ meal, entry: e })}>
                          <span>
                            <strong>{e.productName}</strong> {e.productBrand && <span className="muted">{e.productBrand}</span>}
                            <br />
                            <span className="muted small">{entryQuantity(e)}</span>
                          </span>
                          <span className="right small">
                            {e.nutrients.kcal != null ? `${formatNumber(e.nutrients.kcal, 0)} kcal` : "kcal n.d."}
                            <br />
                            <span className="muted" title={e.costEstimated ? "Quantità acquistata stimata" : undefined}>
                              {e.costCents != null ? `${e.costEstimated ? "≈ " : ""}${formatCents(e.costCents)}` : "costo n.d."}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="meal-actions">
                  <button type="button" className="link small add-entry" onClick={() => setEditing({ meal })}>
                    + Aggiungi a {MEAL_LABELS[meal].toLowerCase()}
                  </button>
                  <button
                    type="button"
                    className="link small add-entry"
                    aria-label={`Ripeti un ${MEAL_LABELS[meal].toLowerCase()} precedente`}
                    onClick={() => setRepeating(meal)}
                  >
                    ↻ Ripeti
                  </button>
                </div>
              </section>
            );
          })}

        </>
      )}

      {/* Outside the data block: changing a setting refetches, and must not collapse the panel being used. */}
      <details className="details">
        <summary>Come è calcolato il costo</summary>
        <p className="muted small">
          Costo per grammo dagli scontrini: {costLabel(cost)} fino al giorno del diario (se non ce ne sono, l&apos;ultimo prezzo;
          per un giorno precedente al primo acquisto, il primo prezzo). «n.d.» se il prodotto non è mai stato comprato con una
          quantità nota; «≈» se la quantità acquistata è stimata (pezzi × peso medio). Il totale somma i costi delle voci, già
          arrotondati al centesimo.
        </p>
        <label className="field">
          <span className="field-label">Calcola il costo con</span>
          <select className="input" value={cost.mode} onChange={(e) => changeCost({ mode: e.target.value as CostMode })}>
            <option value="average">media degli acquisti recenti</option>
            <option value="last">ultimo prezzo pagato</option>
          </select>
        </label>
        {cost.mode === "average" && (
          <label className="field">
            <span className="field-label">Acquisti degli ultimi</span>
            <select className="input" value={cost.windowDays} onChange={(e) => changeCost({ windowDays: Number(e.target.value) })}>
              {COST_WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w} giorni
                </option>
              ))}
            </select>
          </label>
        )}
      </details>

      <Dialog
        open={repeating != null}
        title={`Ripeti ${repeating ? MEAL_LABELS[repeating].toLowerCase() : ""}`}
        onClose={() => setRepeating(null)}
      >
        {repeating && <RepeatMealForm key={`${date}-${repeating}`} date={date} meal={repeating} onDone={() => setRepeating(null)} />}
      </Dialog>
      <Dialog
        open={editing != null}
        title={editing?.entry ? "Modifica voce" : `Aggiungi a ${editing ? MEAL_LABELS[editing.meal].toLowerCase() : ""}`}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <DiaryEntryForm
            key={editing.entry?.id ?? `new-${editing.meal}`}
            date={date}
            meal={editing.meal}
            entry={editing.entry}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </>
  );
}
