import { useState } from "react";
import type { Product } from "../../shared/api";
import { portionInput } from "../../shared/schemas";
import { formatAmount, parseAmount } from "../../shared/quantity";
import { useDeletePortion, usePortions, useSavePortion } from "../queries";
import { ErrorText, Field, QueryState } from "./ui";

/** A product's saved servings ("1 banana" = 120 g), used by the diary. */
export function PortionsSection({ product }: { product: Product }) {
  const portions = usePortions(product.id);
  const save = useSavePortion();
  const remove = useDeletePortion();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(product.avgPieceAmount ? String(product.avgPieceAmount) : "");
  const [error, setError] = useState<unknown>(null);
  const sizeUnit = product.unit === "ml" ? "ml" : "g";

  async function add() {
    setError(null);
    const grams = parseAmount(amount, sizeUnit);
    const input = { name, amount: grams ?? 0 };
    const check = portionInput.safeParse(input);
    if (!grams || !check.success) return setError(!grams ? "Quantità non valida (es. 120 g)" : check.error?.issues[0]?.message);
    try {
      await save.mutateAsync({ ...input, productId: product.id });
      setName("");
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="card" aria-labelledby="portions-title">
      <h2 id="portions-title">Porzioni</h2>
      <p className="muted small">Per segnare nel diario «1 vasetto» o «2 fette» invece dei grammi.</p>
      <QueryState isLoading={portions.isLoading} error={portions.error} />
      {portions.data && portions.data.length > 0 && (
        <ul className="list" data-testid="portions">
          {portions.data.map((p) => (
            <li key={p.id} className="list-item">
              <span>
                <strong>{p.name}</strong> <span className="muted">{formatAmount(p.amount, sizeUnit)}</span>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Elimina porzione ${p.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutateAsync(p.id).catch(setError)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <Field label="Nome porzione" hint="es. 1 vasetto, 1 fetta">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={sizeUnit === "ml" ? "Millilitri" : "Grammi"}>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <ErrorText error={error} />
      <div className="actions">
        <button type="button" className="button" disabled={save.isPending || !name.trim()} onClick={add}>
          + Aggiungi porzione
        </button>
      </div>
    </section>
  );
}
