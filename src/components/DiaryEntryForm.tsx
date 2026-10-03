import { useMemo, useState, type FormEvent } from "react";
import type { DiaryEntry, Product } from "../../shared/api";
import { MEAL_LABELS, MEALS, nutrientsFor, portionAmount, savedPortionGrams, type Meal } from "../../shared/diary";
import { formatAmount, parseAmount } from "../../shared/quantity";
import { diaryEntryInput, portionInput } from "../../shared/schemas";
import { formatNumber, parseDecimalInput } from "../format";
import { useDeleteDiaryEntry, useFrequentProducts, usePortions, useProducts, useSaveDiaryEntry, useSavePortion } from "../queries";
import { ProductForm } from "./ProductForm";
import { ProductPicker } from "./ProductPicker";
import { ConfirmButton, Dialog, ErrorText, Field, QueryState } from "./ui";

type Props = { date: string; meal: Meal; entry?: DiaryEntry; onDone: () => void };

/** Add or edit what was eaten: product, then grams or a saved portion × quantity. */
export function DiaryEntryForm({ date, meal: initialMeal, entry, onDone }: Props) {
  const products = useProducts();
  const frequent = useFrequentProducts();
  const save = useSaveDiaryEntry();
  const remove = useDeleteDiaryEntry();
  const savePortion = useSavePortion();

  const [meal, setMeal] = useState<Meal>(entry?.meal ?? initialMeal);
  const [productId, setProductId] = useState<number | null>(entry?.productId ?? null);
  const [mode, setMode] = useState<"amount" | "portion">(entry?.portionId != null ? "portion" : "amount");
  const [amountText, setAmountText] = useState(entry && entry.portionId == null ? String(entry.amount) : "");
  const [portionId, setPortionId] = useState<number | null>(entry?.portionId ?? null);
  const [qtyText, setQtyText] = useState(entry?.portionQty != null ? formatNumber(entry.portionQty, 2) : "1");
  const [newPortion, setNewPortion] = useState<{ name: string; amount: string } | null>(null);
  const [creatingProduct, setCreatingProduct] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const product = products.data?.find((p) => p.id === productId) ?? null;
  const portions = usePortions(productId);
  const sizeUnit = product?.unit === "ml" ? "ml" : "g";

  // Eaten often and recently first; a small push for what's bought often (new diary, nothing eaten yet).
  const boost = useMemo(() => {
    const list = frequent.data ?? [];
    const rank = new Map(list.map((f, i) => [f.productId, 1 - i / Math.max(list.length, 1)]));
    const maxBought = Math.max(1, ...(products.data ?? []).map((p) => p.purchaseCount));
    return (p: Product) => rank.get(p.id) ?? 0.3 * (p.purchaseCount / maxBought);
  }, [frequent.data, products.data]);

  const portion = portions.data?.find((p) => p.id === portionId) ?? null;
  // Editing a saved entry with its own portion: the weight that portion had then (same rule as the server).
  const keptGrams =
    entry && portion && portion.id === entry.portionId && productId === entry.productId ? savedPortionGrams(entry) : null;
  const portionGrams = keptGrams ?? portion?.amount ?? null;
  const qty = parseDecimalInput(qtyText);
  const amount =
    mode === "amount"
      ? product && amountText
        ? parseAmount(amountText, sizeUnit)
        : null
      : portionGrams != null && qty != null && qty > 0
        ? portionAmount(portionGrams, qty)
        : null;
  const preview = product && amount ? nutrientsFor(product, amount) : null;

  function selectProduct(p: Product) {
    setProductId(p.id);
    setPortionId(null);
  }

  async function addPortion() {
    if (!product || !newPortion) return;
    const grams = parseAmount(newPortion.amount, sizeUnit);
    const check = portionInput.safeParse({ name: newPortion.name, amount: grams ?? 0 });
    if (!grams || !check.success) return setError(!grams ? "Quantità della porzione non valida" : check.error?.issues[0]?.message);
    try {
      const { id } = await savePortion.mutateAsync({ productId: product.id, name: newPortion.name, amount: grams });
      setPortionId(id);
      setNewPortion(null);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!product) return setError("Scegli il prodotto");
    if (mode === "amount" && amount == null) return setError(sizeUnit === "ml" ? "Quantità non valida (es. 200 ml)" : "Peso non valido (es. 80 g)");
    if (mode === "portion" && !portion) return setError("Scegli la porzione");
    if (mode === "portion" && (qty == null || qty <= 0)) return setError("Numero di porzioni non valido (es. 1, 1,5)");
    const input =
      mode === "amount"
        ? { date, meal, productId: product.id, amount }
        : { date, meal, productId: product.id, portionId, portionQty: qty };
    const check = diaryEntryInput.safeParse(input);
    if (!check.success) return setError(check.error.issues[0]?.message ?? "Dati non validi");
    try {
      await save.mutateAsync({ ...input, id: entry?.id });
      onDone();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <Field label="Pasto">
        <select className="input" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
          {MEALS.map((m) => (
            <option key={m} value={m}>
              {MEAL_LABELS[m]}
            </option>
          ))}
        </select>
      </Field>
      {/* Until the catalog is loaded the picker could only offer "create": that would make duplicates. */}
      {products.isLoading && <p className="muted">Caricamento dei prodotti…</p>}
      <QueryState isLoading={false} error={products.error} />
      {products.data && (
        <ProductPicker
          label="Alimento"
          products={products.data}
          value={product}
          autoFocus={!entry}
          boost={boost}
          onSelect={selectProduct}
          onCreate={(name) => setCreatingProduct(name)}
        />
      )}
      {product && product.kcal100 == null && (
        <p className="muted small">Questo prodotto non ha valori nutrizionali: li puoi aggiungere dalla sua scheda.</p>
      )}

      {product && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Come indichi la quantità">
            <label>
              <input type="radio" name="mode" checked={mode === "amount"} onChange={() => setMode("amount")} />
              {sizeUnit === "ml" ? "Millilitri" : "Grammi"}
            </label>
            <label>
              <input type="radio" name="mode" checked={mode === "portion"} onChange={() => setMode("portion")} />
              Porzioni
            </label>
          </div>

          {mode === "amount" ? (
            <Field
              label={sizeUnit === "ml" ? "Quantità (ml)" : "Peso (g)"}
              hint={product.avgPieceAmount ? `1 pezzo ≈ ${formatAmount(product.avgPieceAmount, sizeUnit)}` : undefined}
            >
              <input
                className="input"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder={sizeUnit === "ml" ? "es. 200" : "es. 80"}
              />
            </Field>
          ) : (
            <>
              <div className="row">
                <Field label="Porzione">
                  <select
                    className="input"
                    value={portionId ?? ""}
                    onChange={(e) => (e.target.value === "new" ? setNewPortion({ name: "", amount: "" }) : setPortionId(Number(e.target.value)))}
                  >
                    <option value="" disabled>
                      {portions.data?.length ? "Scegli…" : "Nessuna porzione salvata"}
                    </option>
                    {portions.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatAmount(p.amount, sizeUnit)})
                      </option>
                    ))}
                    <option value="new">+ Nuova porzione…</option>
                  </select>
                </Field>
                <Field label="Quante">
                  <input className="input" inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
                </Field>
              </div>
              {keptGrams != null && portion && Math.round(keptGrams) !== portion.amount && (
                <p className="muted small" data-testid="kept-portion">
                  Per questa voce «{portion.name}» = {formatAmount(Math.round(keptGrams), sizeUnit)} (il peso di allora; oggi{" "}
                  {formatAmount(portion.amount, sizeUnit)}).
                </p>
              )}
              {newPortion && (
                <div className="card">
                  <div className="row">
                    <Field label="Nome porzione" hint="es. 1 vasetto">
                      <input className="input" value={newPortion.name} onChange={(e) => setNewPortion({ ...newPortion, name: e.target.value })} />
                    </Field>
                    <Field label={sizeUnit === "ml" ? "Millilitri della porzione" : "Grammi della porzione"}>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={newPortion.amount}
                        onChange={(e) => setNewPortion({ ...newPortion, amount: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="actions">
                    <button type="button" className="button" onClick={() => setNewPortion(null)}>
                      Annulla
                    </button>
                    <button type="button" className="button" disabled={savePortion.isPending} onClick={addPortion}>
                      Salva porzione
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {preview && amount && (
            <p className="muted small" data-testid="entry-preview">
              {formatAmount(amount, sizeUnit)}
              {preview.kcal != null && ` · ${formatNumber(preview.kcal, 0)} kcal`}
              {preview.protein != null && ` · P ${formatNumber(preview.protein)} g`}
              {preview.fat != null && ` · G ${formatNumber(preview.fat)} g`}
              {preview.carbs != null && ` · C ${formatNumber(preview.carbs)} g`}
            </p>
          )}
        </>
      )}

      <ErrorText error={error} />
      <div className="actions">
        {entry && (
          <ConfirmButton
            label="Elimina"
            confirmLabel="Conferma eliminazione"
            disabled={remove.isPending}
            onConfirm={() => remove.mutateAsync(entry.id).then(onDone, setError)}
          />
        )}
        <button type="submit" className="button primary" disabled={save.isPending}>
          {save.isPending ? "Salvataggio…" : "Salva"}
        </button>
      </div>

      <Dialog open={creatingProduct != null} title="Nuovo prodotto" onClose={() => setCreatingProduct(null)}>
        {creatingProduct != null && (
          <ProductForm
            initialName={creatingProduct}
            onCancel={() => setCreatingProduct(null)}
            onSaved={(id) => {
              setProductId(id);
              setCreatingProduct(null);
            }}
            onUseExisting={(id) => {
              setProductId(id);
              setCreatingProduct(null);
            }}
          />
        )}
      </Dialog>
    </form>
  );
}
