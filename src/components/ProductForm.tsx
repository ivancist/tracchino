import { useState, type FormEvent } from "react";
import type { Product } from "../../shared/api";
import { formatAmount, parseAmount } from "../../shared/quantity";
import { productInput } from "../../shared/schemas";
import { PRODUCT_UNITS, UNIT_LABELS, type ProductUnit } from "../../shared/types";
import { useGroups, useSaveGroup, useSaveProduct } from "../queries";
import { ErrorText, Field } from "./ui";

const NUTRIENTS = [
  ["kcal100", "kcal"],
  ["protein100", "Proteine (g)"],
  ["fat100", "Grassi (g)"],
  ["carbs100", "Carboidrati (g)"],
  ["sugars100", "di cui zuccheri (g)"],
] as const;

const NEW_GROUP = "__new__";

function parseDecimal(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

type Props = { product?: Product; initialName?: string; onSaved: (id: number) => void; onCancel?: () => void };

export function ProductForm({ product, initialName, onSaved, onCancel }: Props) {
  const groups = useGroups();
  const saveProduct = useSaveProduct();
  const saveGroup = useSaveGroup();
  const [error, setError] = useState<unknown>(null);

  const [name, setName] = useState(product?.name ?? initialName ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [unit, setUnit] = useState<ProductUnit>(product?.unit ?? "g");
  const [packageAmount, setPackageAmount] = useState(product?.packageAmount ? String(product.packageAmount) : "");
  const [avgPieceAmount, setAvgPieceAmount] = useState(product?.avgPieceAmount ? String(product.avgPieceAmount) : "");
  const [groupId, setGroupId] = useState(product?.groupId ? String(product.groupId) : "");
  const [newGroup, setNewGroup] = useState("");
  const [nutrition, setNutrition] = useState<Record<string, string>>(() =>
    Object.fromEntries(NUTRIENTS.map(([k]) => [k, product?.[k] != null ? String(product[k]).replace(".", ",") : ""])),
  );

  // Package/piece sizes are always grams for "pz" products (used to estimate €/kg).
  const sizeUnit: ProductUnit = unit === "ml" ? "ml" : "g";
  const pkg = packageAmount ? parseAmount(packageAmount, sizeUnit) : null;
  const piece = avgPieceAmount ? parseAmount(avgPieceAmount, sizeUnit) : null;
  const busy = saveProduct.isPending || saveGroup.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (packageAmount && pkg == null) return setError("Formato confezione non valido (es. 500 g, 1 kg, 1,5 l)");
    if (avgPieceAmount && piece == null) return setError("Peso medio non valido (es. 120 g)");
    const nutritionValues = Object.fromEntries(NUTRIENTS.map(([k]) => [k, parseDecimal(nutrition[k] ?? "")]));
    if (Object.values(nutritionValues).some((v) => Number.isNaN(v))) return setError("Valori nutrizionali non validi");

    try {
      let resolvedGroupId: number | null = groupId && groupId !== NEW_GROUP ? Number(groupId) : null;
      if (groupId === NEW_GROUP && newGroup.trim()) {
        resolvedGroupId = (await saveGroup.mutateAsync({ name: newGroup })).id;
      }
      const input = { name, brand, unit, packageAmount: pkg, avgPieceAmount: piece, groupId: resolvedGroupId, ...nutritionValues };
      const parsed = productInput.safeParse(input);
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Dati non validi");
      const { id } = await saveProduct.mutateAsync({ ...input, id: product?.id });
      onSaved(id);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Nome">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!product} />
      </Field>
      <Field label="Marca">
        <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="facoltativa" />
      </Field>
      <Field label="Come lo compri">
        <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as ProductUnit)}>
          {PRODUCT_UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <Field label="Confezione" hint={pkg ? formatAmount(pkg, sizeUnit) : "es. 500 g, 1 l"}>
          <input className="input" value={packageAmount} onChange={(e) => setPackageAmount(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Peso medio a pezzo" hint={piece ? formatAmount(piece, sizeUnit) : "es. banana 120 g"}>
          <input className="input" value={avgPieceAmount} onChange={(e) => setAvgPieceAmount(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <Field label="Gruppo" hint="Per confrontare marche diverse dello stesso prodotto">
        <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Nessuno</option>
          {groups.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value={NEW_GROUP}>+ Nuovo gruppo…</option>
        </select>
      </Field>
      {groupId === NEW_GROUP && (
        <Field label="Nome del nuovo gruppo">
          <input className="input" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} required />
        </Field>
      )}
      <details className="details" open={NUTRIENTS.some(([k]) => nutrition[k])}>
        <summary>Valori nutrizionali (per 100 {sizeUnit})</summary>
        <div className="grid-2">
          {NUTRIENTS.map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                className="input"
                inputMode="decimal"
                value={nutrition[key]}
                onChange={(e) => setNutrition((n) => ({ ...n, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
      </details>
      <ErrorText error={error} />
      <div className="actions">
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Annulla
          </button>
        )}
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Salvataggio…" : "Salva prodotto"}
        </button>
      </div>
    </form>
  );
}
