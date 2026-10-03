import { useState, type FormEvent } from "react";
import type { Product } from "../../shared/api";
import { formatIsoDate } from "../../shared/dates";
import { formatCents } from "../../shared/money";
import { perPackageCents, unitPrices } from "../../shared/pricing";
import { formatAmount, formatPackagesPieces, parseAmount, perKiloSuffix } from "../../shared/quantity";
import { storedCost } from "../costPreference";
import { consumptionText, frequencyText, isFinished, stockText } from "../pantryText";
import { useCorrectStock, usePantry, usePriceStats } from "../queries";
import { ErrorText, Field, QueryState } from "./ui";

/** What a package is and what it costs, from the latest purchase. First thing on the product page. */
export function PackageSummary({ product }: { product: Product }) {
  const stats = usePriceStats("products", product.id);
  const last = stats.data?.purchases[0]; // newest first
  const size =
    product.packageAmount != null
      ? `Confezione da ${formatAmount(product.packageAmount, product.unit)}`
      : product.unit === "pz"
        ? "Venduto a pezzi"
        : "Sfuso, senza confezione fissa";

  let price: { main: string; details: string[] } | null = null;
  if (last) {
    const u = unitPrices(last, last);
    const perPackage = product.packageAmount != null ? (perPackageCents(u.paidCents, last.packages) ?? u.paidCents) : null;
    const qty = [formatPackagesPieces(last), last.amount != null ? formatAmount(last.amount, last.unit) : null].filter(Boolean).join(" · ");
    price = {
      main: perPackage != null ? `${last.packages == null ? "≈ " : ""}${formatCents(perPackage)} a confezione` : `${formatCents(u.paidCents)}${qty ? ` per ${qty}` : ""}`,
      details: [
        u.perKilo ? `${u.perKilo.source === "estimated" ? "≈ " : ""}${formatCents(u.perKilo.cents)}${perKiloSuffix(product.unit)}` : "",
        u.perPiece != null ? `${formatCents(u.perPiece)}/pz` : "",
        perPackage != null && qty ? `pagati ${formatCents(u.paidCents)} per ${qty}` : "",
      ].filter(Boolean),
    };
  }

  return (
    <section className="card" data-testid="package-summary">
      <p className="summary-size">{size}</p>
      <QueryState isLoading={stats.isLoading} error={stats.error} />
      {stats.data && !price && <p className="muted">Mai comprato: nessun prezzo ancora.</p>}
      {price && last && (
        <>
          <p className="summary-price" data-testid="package-price">
            {price.main}
          </p>
          {price.details.length > 0 && <p className="small">{price.details.join(" · ")}</p>}
          <p className="muted small">
            Ultimo acquisto: {last.chainName}, {formatIsoDate(last.date)}
          </p>
        </>
      )}
    </section>
  );
}

/** Stock left, its correction (shared meals: the diary has only the owner's portions) and the product's consumption. */
export function StockSection({ product }: { product: Product }) {
  const [cost] = useState(storedCost);
  const pantry = usePantry(cost.mode, cost.windowDays);
  const correct = useCorrectStock();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const item = pantry.data?.find((i) => i.productId === product.id);
  const unit = product.unit === "ml" ? "ml" : "g";

  const save = (amount: number) =>
    correct.mutate(
      { productId: product.id, amount },
      {
        onSuccess: () => {
          setEditing(false);
          setText("");
        },
      },
    );
  function submit(e: FormEvent) {
    e.preventDefault();
    const amount = text.trim() === "0" ? 0 : parseAmount(text, product.unit);
    if (amount == null) return setError(unit === "ml" ? "Quantità non valida (es. 750 ml, 1,5 l)" : "Peso non valido (es. 300 g, 1,2 kg)");
    setError(null);
    save(amount);
  }

  return (
    <section className="card" data-testid="stock-section">
      <h2>Scorta e consumi</h2>
      <QueryState isLoading={pantry.isLoading} error={pantry.error} />
      {pantry.data && (
        <>
          {item ? (
            <p data-testid="stock-text">
              {isFinished(item) ? <span className="badge finished first">Finito</span> : stockText(item)}
              {item.stock?.corrected && <span className="muted small"> · corretta da te</span>}
            </p>
          ) : (
            <p className="muted">Nessun dato: non l'hai mangiato negli ultimi 30 giorni e non hai indicato la scorta.</p>
          )}
          {item?.rate && (
            <>
              <p className="small">{frequencyText(item)}</p>
              <p className="muted small">{consumptionText(item)}</p>
            </>
          )}
        </>
      )}

      {editing ? (
        <form className="form" onSubmit={submit}>
          <Field label="Quanto ne hai ancora" hint="Da qui si riparte: più gli acquisti e meno il diario successivi.">
            <input
              className="input"
              inputMode="decimal"
              placeholder={unit === "ml" ? "es. 750 ml" : "es. 300 g"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          </Field>
          <ErrorText error={error ?? correct.error} />
          <div className="actions">
            <button type="button" className="button" onClick={() => setEditing(false)}>
              Annulla
            </button>
            <button type="button" className="button" disabled={correct.isPending} onClick={() => save(0)}>
              È finito
            </button>
            {product.packageAmount != null && (
              <button type="button" className="button" disabled={correct.isPending} onClick={() => save(product.packageAmount!)}>
                1 confezione intera
              </button>
            )}
            <button type="submit" className="button primary" disabled={correct.isPending || !text.trim()}>
              Salva
            </button>
          </div>
        </form>
      ) : (
        <div className="actions start">
          <button type="button" className="button" onClick={() => setEditing(true)}>
            Correggi la scorta
          </button>
        </div>
      )}
      <p className="muted small">Mangi con altri e segni solo le tue porzioni? Correggi la scorta quando non torna.</p>
    </section>
  );
}
