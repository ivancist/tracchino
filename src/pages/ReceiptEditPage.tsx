import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { LastPrice, Product, ReceiptDetail } from "../../shared/api";
import { formatIsoDate, todayRome } from "../../shared/dates";
import { centsToInput, formatCents, parseEuroToCents } from "../../shared/money";
import { unitPrices } from "../../shared/pricing";
import { formatAmount, parseAmount, perKiloSuffix } from "../../shared/quantity";
import { receiptInput, type ReceiptInput } from "../../shared/schemas";
import { ProductForm } from "../components/ProductForm";
import { ProductPicker } from "../components/ProductPicker";
import { StoreForm } from "../components/StoreForm";
import { ConfirmButton, Dialog, ErrorText, Field, PageHeader, QueryState } from "../components/ui";
import { useDeleteReceipt, useLastPrices, useProducts, useReceipt, useSaveReceipt, useStores } from "../queries";

type Line = {
  key: number;
  productId: number | null;
  rawText: string | null;
  price: string;
  discount: string;
  pieces: string;
  amount: string;
  showDiscount: boolean;
};

let nextKey = 1;
const emptyLine = (): Line => ({
  key: nextKey++,
  productId: null,
  rawText: null,
  price: "",
  discount: "",
  pieces: "",
  amount: "",
  showDiscount: false,
});

function linesFrom(receipt: ReceiptDetail): Line[] {
  return receipt.items.map((i) => ({
    key: nextKey++,
    productId: i.productId,
    rawText: i.rawText,
    price: centsToInput(i.priceFullCents),
    discount: i.discountCents ? centsToInput(i.discountCents) : "",
    pieces: i.pieces != null ? String(i.pieces) : "",
    amount: i.amount != null ? String(i.amount) : "",
    showDiscount: i.discountCents > 0,
  }));
}

type ParsedLine = {
  product: Product | null;
  priceFullCents: number | null;
  discountCents: number | null;
  pieces: number | null;
  amount: number | null;
  errors: string[];
};

function parseLine(line: Line, product: Product | null): ParsedLine {
  const errors: string[] = [];
  const priceFullCents = line.price ? parseEuroToCents(line.price) : null;
  const discountCents = line.discount ? parseEuroToCents(line.discount) : 0;
  const pieces = line.pieces ? (/^\d+$/.test(line.pieces.trim()) && Number(line.pieces) > 0 ? Number(line.pieces) : NaN) : null;
  const amount = line.amount && product ? parseAmount(line.amount, product.unit === "ml" ? "ml" : "g") : null;

  if (!product) errors.push("Scegli il prodotto");
  if (priceFullCents == null) errors.push(line.price ? "Prezzo non valido" : "Inserisci il prezzo");
  if (discountCents == null) errors.push("Sconto non valido");
  if (priceFullCents != null && discountCents != null && discountCents > priceFullCents) errors.push("Lo sconto supera il prezzo");
  if (Number.isNaN(pieces)) errors.push("Pezzi: numero intero");
  if (line.amount && amount == null) errors.push(product?.unit === "ml" ? "Quantità non valida (es. 1,5 l)" : "Peso non valido (es. 850 g, 1,2 kg)");
  return { product, priceFullCents, discountCents, pieces: Number.isNaN(pieces) ? null : pieces, amount, errors };
}

/** Loads what the editor needs, then mounts it with its initial state (no state syncing in effects). */
export function ReceiptEditPage() {
  const params = useParams();
  const receiptId = params.id ? Number(params.id) : null;
  const products = useProducts();
  const stores = useStores();
  const existing = useReceipt(receiptId);

  const loading = products.isLoading || stores.isLoading || (receiptId != null && existing.isLoading);
  const loadError = products.error ?? stores.error ?? existing.error;
  if (loading || loadError) return <QueryState isLoading={loading} error={loadError} />;
  return <ReceiptEditor key={receiptId ?? "new"} receipt={existing.data ?? null} />;
}

function ReceiptEditor({ receipt }: { receipt: ReceiptDetail | null }) {
  const receiptId = receipt?.id ?? null;
  const navigate = useNavigate();

  const products = useProducts();
  const stores = useStores();
  const save = useSaveReceipt();
  const remove = useDeleteReceipt();

  const [chosenStoreId, setStoreId] = useState<number | null>(receipt?.storeId ?? null);
  const [date, setDate] = useState(receipt?.date ?? todayRome());
  const [totalPrinted, setTotalPrinted] = useState(receipt?.totalPrintedCents != null ? centsToInput(receipt.totalPrintedCents) : "");
  const [notes, setNotes] = useState(receipt?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => (receipt ? linesFrom(receipt) : [emptyLine()]));
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [creatingProduct, setCreatingProduct] = useState<{ lineKey: number; name: string } | null>(null);
  const [creatingStore, setCreatingStore] = useState(false);
  const [focusKey, setFocusKey] = useState<number | null>(null);

  // New receipt: default to the most recently used store (stores come sorted by last use).
  const storeId = chosenStoreId ?? stores.data?.[0]?.id ?? null;

  const lastPrices = useLastPrices(storeId, receiptId);
  const lastPriceByProduct = useMemo(
    () => new Map<number, LastPrice>(lastPrices.data?.map((p) => [p.productId, p]) ?? []),
    [lastPrices.data],
  );
  const productById = useMemo(() => new Map(products.data?.map((p) => [p.id, p]) ?? []), [products.data]);

  const parsed = lines.map((l) => parseLine(l, l.productId != null ? (productById.get(l.productId) ?? null) : null));
  // A line left completely empty (e.g. the last "+ Aggiungi prodotto") is ignored, not an error.
  const isBlank = (l: Line) => l.productId == null && !l.price && !l.discount && !l.pieces && !l.amount;
  const filled = lines.map((l, i) => ({ line: l, parsed: parsed[i]! })).filter(({ line }) => !isBlank(line));
  const invalidCount = filled.filter(({ parsed: p }) => p.errors.length > 0).length;
  // Only complete lines count, so the total never silently includes half-typed ones (they're flagged instead).
  const totalCents = filled
    .filter(({ parsed: p }) => p.errors.length === 0)
    .reduce((sum, { parsed: p }) => sum + p.priceFullCents! - p.discountCents!, 0);
  const printedCents = totalPrinted ? parseEuroToCents(totalPrinted) : null;

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function selectProduct(key: number, product: Product) {
    const line = lines.find((l) => l.key === key);
    const last = lastPriceByProduct.get(product.id);
    // Prefill the price paid last time at this store (the usual case); never overwrite what was typed.
    updateLine(key, {
      productId: product.id,
      ...(line && !line.price && last ? { price: centsToInput(last.priceFullCents) } : {}),
    });
  }

  function addLine() {
    const line = emptyLine();
    setLines((ls) => [...ls, line]);
    setFocusKey(line.key);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (storeId == null) return setError("Scegli il negozio");
    if (totalPrinted && printedCents == null) return setError("Totale stampato non valido");
    if (filled.length === 0) return setError("Aggiungi almeno un prodotto");
    if (invalidCount > 0) return setError("Correggi le righe evidenziate");

    const input: ReceiptInput = {
      storeId,
      date,
      totalPrintedCents: printedCents,
      notes,
      items: filled.map(({ line, parsed: p }) => ({
        productId: p.product!.id,
        rawText: line.rawText,
        pieces: p.pieces,
        amount: p.amount,
        priceFullCents: p.priceFullCents!,
        discountCents: p.discountCents!,
      })),
    };
    // Same schema as the server: catches anything the per-line checks missed (e.g. an emptied date).
    const check = receiptInput.safeParse(input);
    if (!check.success) return setError(check.error.issues[0]?.message ?? "Dati non validi");
    try {
      await save.mutateAsync({ ...input, id: receiptId ?? undefined });
      navigate("/");
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="form receipt-form" onSubmit={submit} noValidate>
      <PageHeader
        title={receiptId ? "Modifica scontrino" : "Nuovo scontrino"}
        back={
          <Link to="/" className="back" aria-label="Indietro">
            ‹
          </Link>
        }
      />

      <div className="row">
        <Field label="Negozio">
          <select
            className="input"
            value={storeId ?? ""}
            onChange={(e) => (e.target.value === "new" ? setCreatingStore(true) : setStoreId(Number(e.target.value)))}
          >
            <option value="" disabled>
              Scegli…
            </option>
            {stores.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.chainName} · {s.name}
              </option>
            ))}
            <option value="new">+ Nuovo negozio…</option>
          </select>
        </Field>
        <Field label="Data" hint={formatIsoDate(date)}>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>

      <ol className="lines">
        {lines.map((line, index) => {
          const p = parsed[index]!;
          const product = p.product;
          const last = product ? lastPriceByProduct.get(product.id) : undefined;
          const prices =
            product && p.priceFullCents != null && p.discountCents != null
              ? unitPrices({ ...p, priceFullCents: p.priceFullCents, discountCents: p.discountCents }, product)
              : null;
          const sizeUnit = product?.unit === "ml" ? "ml" : "g";
          return (
            <li key={line.key} className={submitted && p.errors.length && !isBlank(line) ? "line invalid" : "line"} data-testid="receipt-line">
              <div className="line-head">
                <ProductPicker
                  products={products.data ?? []}
                  value={product}
                  autoFocus={focusKey === line.key}
                  label={`Prodotto riga ${index + 1}`}
                  onSelect={(prod) => selectProduct(line.key, prod)}
                  onCreate={(name) => setCreatingProduct({ lineKey: line.key, name })}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Rimuovi riga ${index + 1}`}
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== line.key) : [emptyLine()]))}
                >
                  ✕
                </button>
              </div>
              {line.rawText && <p className="muted small">Sullo scontrino: {line.rawText}</p>}
              <div className="grid-3">
                <Field label="Prezzo €">
                  <input
                    className="input"
                    inputMode="decimal"
                    aria-label={`Prezzo riga ${index + 1}`}
                    value={line.price}
                    onChange={(e) => updateLine(line.key, { price: e.target.value })}
                    placeholder="0,00"
                  />
                </Field>
                <Field label="Pezzi">
                  <input
                    className="input"
                    inputMode="numeric"
                    aria-label={`Pezzi riga ${index + 1}`}
                    value={line.pieces}
                    onChange={(e) => updateLine(line.key, { pieces: e.target.value })}
                  />
                </Field>
                <Field label={sizeUnit === "ml" ? "Volume" : "Peso"}>
                  <input
                    className="input"
                    inputMode="decimal"
                    aria-label={`Quantità riga ${index + 1}`}
                    value={line.amount}
                    onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                    placeholder={sizeUnit === "ml" ? "ml" : "g"}
                  />
                </Field>
              </div>
              {line.showDiscount ? (
                <Field label="Sconto €">
                  <input
                    className="input"
                    inputMode="decimal"
                    aria-label={`Sconto riga ${index + 1}`}
                    value={line.discount}
                    onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                    placeholder="0,00"
                  />
                </Field>
              ) : (
                <button type="button" className="link small" onClick={() => updateLine(line.key, { showDiscount: true })}>
                  + sconto
                </button>
              )}
              <p className="line-info small">
                {prices && <strong>{formatCents(prices.paidCents)}</strong>}
                {prices?.perKilo && product && (
                  <span>
                    {prices.perKilo.source === "estimated" ? "≈ " : ""}
                    {formatCents(prices.perKilo.cents)}
                    {perKiloSuffix(product.unit)}
                  </span>
                )}
                {prices?.perPiece != null && <span>{formatCents(prices.perPiece)}/pz</span>}
                {p.amount != null && product && <span>{formatAmount(p.amount, sizeUnit)}</span>}
                {last && (
                  <span className="muted">
                    ultima volta {formatCents(last.priceFullCents - last.discountCents)} ({formatIsoDate(last.date)})
                  </span>
                )}
              </p>
              {submitted && p.errors.length > 0 && !isBlank(line) && <p className="error small">{p.errors.join(" · ")}</p>}
            </li>
          );
        })}
      </ol>

      <button type="button" className="button" onClick={addLine}>
        + Aggiungi prodotto
      </button>

      <details className="details" open={!!totalPrinted || !!notes}>
        <summary>Totale stampato e note</summary>
        <Field
          label="Totale sullo scontrino €"
          hint={
            printedCents != null && printedCents !== totalCents
              ? `Differenza di ${formatCents(Math.abs(printedCents - totalCents))} con la somma delle righe`
              : "Per controllare di non aver dimenticato nulla"
          }
        >
          <input className="input" inputMode="decimal" value={totalPrinted} onChange={(e) => setTotalPrinted(e.target.value)} />
        </Field>
        <Field label="Note">
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </details>

      <ErrorText error={error} />

      <div className="savebar">
        <div>
          <span className="muted small">Totale</span>
          <strong data-testid="receipt-total">{formatCents(totalCents)}</strong>
          {invalidCount > 0 && (
            <span className="error small" data-testid="receipt-total-warning">
              {invalidCount === 1 ? "1 riga incompleta esclusa" : `${invalidCount} righe incomplete escluse`}
            </span>
          )}
        </div>
        {receiptId && (
          <ConfirmButton
            label="Elimina"
            confirmLabel="Conferma"
            disabled={remove.isPending}
            onConfirm={() => remove.mutateAsync(receiptId).then(() => navigate("/"), setError)}
          />
        )}
        <button type="submit" className="button primary" disabled={save.isPending}>
          {save.isPending ? "Salvataggio…" : "Salva"}
        </button>
      </div>

      <Dialog open={creatingProduct != null} title="Nuovo prodotto" onClose={() => setCreatingProduct(null)}>
        {creatingProduct && (
          <ProductForm
            initialName={creatingProduct.name}
            onCancel={() => setCreatingProduct(null)}
            onSaved={(id) => {
              // The save resolves after the product list has refetched, so the line can point at it right away.
              updateLine(creatingProduct.lineKey, { productId: id });
              setCreatingProduct(null);
            }}
          />
        )}
      </Dialog>
      <Dialog open={creatingStore} title="Nuovo negozio" onClose={() => setCreatingStore(false)}>
        <StoreForm
          onCancel={() => setCreatingStore(false)}
          onSaved={(id) => {
            setStoreId(id);
            setCreatingStore(false);
          }}
        />
      </Dialog>
    </form>
  );
}
