import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { OffLookup, Product } from "../../shared/api";
import { nutritionWarnings } from "../../shared/nutrition";
import type { OffPrefill } from "../../shared/off";
import { formatAmount, parseAmount } from "../../shared/quantity";
import { barcodeCode, productInput } from "../../shared/schemas";
import { PRODUCT_UNITS, UNIT_LABELS, type ProductUnit } from "../../shared/types";
import { ApiError, errorMessage } from "../api";
import { lookupBarcode, useGroups, useProducts, useSaveGroup, useSaveProduct } from "../queries";
import { BarcodeScanner } from "./BarcodeScanner";
import { ErrorText, Field } from "./ui";

const NUTRIENTS = [
  ["kcal100", "kcal"],
  ["protein100", "Proteine (g)"],
  ["fat100", "Grassi (g)"],
  ["saturatedFat100", "di cui saturi (g)"],
  ["carbs100", "Carboidrati (g)"],
  ["sugars100", "di cui zuccheri (g)"],
  ["fiber100", "Fibre (g)"],
  ["salt100", "Sale (g)"],
] as const;

const NEW_GROUP = "__new__";

type NutritionFields = Record<(typeof NUTRIENTS)[number][0], string>;
const decimalInput = (v: number | null | undefined) => (v != null ? String(v).replace(".", ",") : "");
const emptyNutrition = (n: NutritionFields) => NUTRIENTS.every(([k]) => !n[k].trim());
const nutritionFromPrefill = (p: OffPrefill) =>
  Object.fromEntries(NUTRIENTS.map(([k]) => [k, decimalInput(p.nutrition[k])])) as NutritionFields;
const hasNutrition = (p: OffPrefill) => NUTRIENTS.some(([k]) => p.nutrition[k] != null);

/** Result of the last barcode lookup, shown under the barcode field. */
type Lookup =
  | { state: "loading" }
  | { state: "existing"; productId: number }
  | { state: "prefilled"; warnings: string[]; nutritionPending: OffPrefill | null }
  | { state: "error"; message: string };

/** What the form arrived with from a barcode scan elsewhere (products list). */
export type BarcodeStart = { barcode: string; lookup: OffLookup | null; message?: string };

function parseDecimal(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

type Props = {
  product?: Product;
  initialName?: string;
  /** A barcode already scanned (and looked up) before opening the form. */
  start?: BarcodeStart;
  onSaved: (id: number) => void;
  /** New product whose barcode is already in the catalog: use that product instead. */
  onUseExisting?: (id: number) => void;
  onCancel?: () => void;
};

export function ProductForm({ product, initialName, start, onSaved, onUseExisting, onCancel }: Props) {
  const groups = useGroups();
  const products = useProducts();
  const saveProduct = useSaveProduct();
  const saveGroup = useSaveGroup();
  const [error, setError] = useState<unknown>(null);
  const startPrefill = start?.lookup?.prefill ?? null;

  const [name, setName] = useState(product?.name ?? startPrefill?.name ?? initialName ?? "");
  const [brand, setBrand] = useState(product?.brand ?? startPrefill?.brand ?? "");
  const [unit, setUnit] = useState<ProductUnit>(product?.unit ?? startPrefill?.unit ?? "g");
  const [packageAmount, setPackageAmount] = useState(
    product?.packageAmount ? String(product.packageAmount) : startPrefill?.packageAmount ? String(startPrefill.packageAmount) : "",
  );
  const [avgPieceAmount, setAvgPieceAmount] = useState(product?.avgPieceAmount ? String(product.avgPieceAmount) : "");
  const [groupId, setGroupId] = useState(product?.groupId ? String(product.groupId) : "");
  const [newGroup, setNewGroup] = useState("");
  const [nutrition, setNutrition] = useState<NutritionFields>(() =>
    product
      ? (Object.fromEntries(NUTRIENTS.map(([k]) => [k, decimalInput(product[k])])) as NutritionFields)
      : startPrefill
        ? nutritionFromPrefill(startPrefill)
        : (Object.fromEntries(NUTRIENTS.map(([k]) => [k, ""])) as NutritionFields),
  );
  const [barcode, setBarcode] = useState(product?.barcode ?? start?.barcode ?? "");
  const [scanning, setScanning] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(() => {
    if (!start) return null;
    if (start.lookup?.existingProductId != null) return { state: "existing", productId: start.lookup.existingProductId };
    if (startPrefill) return { state: "prefilled", warnings: startPrefill.warnings, nutritionPending: null };
    return start.message ? { state: "error", message: start.message } : null;
  });
  /** Nutrition exactly as imported from Open Food Facts: saved as source "off" only while unchanged. */
  const [offNutrition, setOffNutrition] = useState<NutritionFields | null>(() =>
    startPrefill && hasNutrition(startPrefill) ? nutritionFromPrefill(startPrefill) : null,
  );

  // The lookup resolves after an await: read the fields as they are then, not as they were when it started
  // (the user may have kept typing).
  const current = useRef({ name, brand, packageAmount, unit, nutrition });
  useEffect(() => {
    current.current = { name, brand, packageAmount, unit, nutrition };
  });

  /** Fills what's still empty (never overwrites typed values); nutrition only when none was entered. */
  function applyPrefill(p: OffPrefill) {
    const now = current.current;
    if (p.name && (!now.name.trim() || now.name === initialName)) setName(p.name);
    if (p.brand && !now.brand.trim()) setBrand(p.brand);
    if (p.packageAmount && !now.packageAmount.trim()) setPackageAmount(String(p.packageAmount));
    // Unit follows OFF for a new product (values per 100 ml vs 100 g), unless sold by the piece or a size was typed.
    if (!product && now.unit !== "pz" && !now.packageAmount.trim()) setUnit(p.unit);
    const nutritionFree = emptyNutrition(now.nutrition);
    if (hasNutrition(p) && nutritionFree) {
      setNutrition(nutritionFromPrefill(p));
      setOffNutrition(nutritionFromPrefill(p));
    }
    setLookup({ state: "prefilled", warnings: p.warnings, nutritionPending: hasNutrition(p) && !nutritionFree ? p : null });
  }

  async function findBarcode(raw: string) {
    const parsed = barcodeCode.safeParse(raw);
    if (!parsed.success) return setLookup({ state: "error", message: parsed.error.issues[0]!.message });
    const code = parsed.data;
    setBarcode(code);
    setLookup({ state: "loading" });
    try {
      const result = await lookupBarcode(code);
      if (result.existingProductId != null) setLookup({ state: "existing", productId: result.existingProductId });
      else applyPrefill(result.prefill);
    } catch (err) {
      setLookup({ state: "error", message: err instanceof ApiError && err.status === 404 ? err.message : errorMessage(err) });
    }
  }

  const existing = lookup?.state === "existing" ? products.data?.find((p) => p.id === lookup.productId) : undefined;
  const parsedNutrition = Object.fromEntries(NUTRIENTS.map(([k]) => [k, parseDecimal(nutrition[k])])) as Record<
    (typeof NUTRIENTS)[number][0],
    number | null
  >;
  const plausibility = Object.values(parsedNutrition).some((v) => Number.isNaN(v)) ? [] : nutritionWarnings(parsedNutrition);

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
      const fromOff = offNutrition != null && NUTRIENTS.every(([k]) => nutrition[k] === offNutrition[k]);
      const input = {
        name,
        brand,
        unit,
        barcode,
        packageAmount: pkg,
        avgPieceAmount: piece,
        groupId: resolvedGroupId,
        ...nutritionValues,
        nutritionSource: fromOff ? ("off" as const) : null,
      };
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
      <Field label="Codice a barre" hint="Facoltativo: precompila nome, formato e valori da Open Food Facts">
        <input
          className="input"
          inputMode="numeric"
          autoComplete="off"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="EAN, es. 8001234567897"
        />
      </Field>
      <div className="actions start">
        <button type="button" className="button" onClick={() => setScanning(true)}>
          📷 Scansiona
        </button>
        <button type="button" className="button" disabled={!barcode.trim() || lookup?.state === "loading"} onClick={() => findBarcode(barcode)}>
          {lookup?.state === "loading" ? "Ricerca…" : "Cerca su Open Food Facts"}
        </button>
      </div>
      {lookup?.state === "existing" && lookup.productId !== product?.id && (
        <div className="notice warn" data-testid="barcode-existing">
          Questo codice è già di «{existing?.name ?? "un altro prodotto"}».
          <div className="actions">
            {!product && onUseExisting ? (
              <button type="button" className="button" onClick={() => onUseExisting(lookup.productId)}>
                Usa «{existing?.name ?? "quel prodotto"}»
              </button>
            ) : (
              <Link to={`/prodotti/${lookup.productId}`} className="button">
                Apri il prodotto
              </Link>
            )}
          </div>
        </div>
      )}
      {lookup?.state === "prefilled" && (
        <div className="notice" data-testid="off-prefilled">
          Dati da Open Food Facts: controllali prima di salvare.
          {lookup.nutritionPending && (
            <div className="actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  const values = nutritionFromPrefill(lookup.nutritionPending!);
                  setNutrition(values);
                  setOffNutrition(values);
                  setLookup({ ...lookup, nutritionPending: null });
                }}
              >
                Sostituisci i valori nutrizionali con quelli di Open Food Facts
              </button>
            </div>
          )}
        </div>
      )}
      {lookup?.state === "error" && <p className="notice warn">{lookup.message}</p>}
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
        {plausibility.length > 0 && (
          <ul className="notice warn small" data-testid="nutrition-warnings">
            {plausibility.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {offNutrition && <p className="muted small">Fonte: {NUTRIENTS.every(([k]) => nutrition[k] === offNutrition[k]) ? "Open Food Facts" : "modificati a mano"}</p>}
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
      <BarcodeScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={(code) => {
          setScanning(false);
          void findBarcode(code);
        }}
      />
    </form>
  );
}
