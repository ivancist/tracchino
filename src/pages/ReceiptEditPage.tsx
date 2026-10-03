import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import type { LastPrice, MatchStatus, Product, ReceiptDetail, ScanResult } from "../../shared/api";
import { formatIsoDate, todayRome } from "../../shared/dates";
import { centsToInput, formatCents, parseEuroToCents } from "../../shared/money";
import { perPieceCents, shouldPrefillPrice, unitPrices } from "../../shared/pricing";
import { formatAmount, parseAmount, perKiloSuffix } from "../../shared/quantity";
import { receiptInput, type ReceiptInput } from "../../shared/schemas";
import { ProductForm } from "../components/ProductForm";
import { ProductPicker } from "../components/ProductPicker";
import { StoreForm } from "../components/StoreForm";
import { ConfirmButton, Dialog, ErrorText, Field, PageHeader, QueryState } from "../components/ui";
import { compressReceiptPhoto } from "../image";
import {
  getPendingScan,
  setPendingScan,
  useChains,
  useDeleteReceipt,
  useLastPrices,
  useProducts,
  useReceipt,
  useSaveReceipt,
  useStores,
  useUploadReceiptPhoto,
  type PendingScan,
} from "../queries";

type Line = {
  key: number;
  productId: number | null;
  rawText: string | null;
  price: string;
  discount: string;
  pieces: string;
  amount: string;
  showDiscount: boolean;
  /** Scanned lines only: how the product was matched, and whether the user has confirmed or changed it. */
  scan: { status: MatchStatus; suggestedName: string | null; confirmed: boolean } | null;
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
  scan: null,
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
    scan: null,
  }));
}

function linesFromScan(result: ScanResult): Line[] {
  return result.lines.map((l) => ({
    key: nextKey++,
    productId: l.productId,
    rawText: l.rawText,
    price: centsToInput(l.priceCents),
    discount: l.discountCents ? centsToInput(l.discountCents) : "",
    pieces: l.pieces != null ? String(l.pieces) : "",
    amount: l.amount != null ? String(l.amount) : "",
    showDiscount: l.discountCents > 0,
    scan: { status: l.status, suggestedName: l.suggestedName, confirmed: false },
  }));
}

/** An uncertain match is never saved by accident: it needs an explicit "Confermo" or a different product. */
const needsConfirmation = (line: Line) => line.scan?.status === "uncertain" && !line.scan.confirmed && line.productId != null;

/** "ultima volta 1,79 € · 0,30 €/pz (ven 2 ott 2026)" */
function lastPriceHint(last: LastPrice): string {
  const paid = last.priceFullCents - last.discountCents;
  const perPiece = perPieceCents(paid, last.pieces);
  return `ultima volta ${formatCents(paid)}${perPiece != null ? ` · ${formatCents(perPiece)}/pz` : ""} (${formatIsoDate(last.date)})`;
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

  if (!product) errors.push(line.scan ? "Scegli il prodotto o crealo" : "Scegli il prodotto");
  if (needsConfirmation(line)) errors.push("Conferma il prodotto proposto o scegline un altro");
  if (priceFullCents == null) errors.push(line.price ? "Prezzo non valido" : "Inserisci il prezzo");
  if (discountCents == null) errors.push("Sconto non valido");
  if (priceFullCents != null && discountCents != null && discountCents > priceFullCents) errors.push("Lo sconto supera il prezzo");
  if (Number.isNaN(pieces)) errors.push("Pezzi: numero intero");
  if (line.amount && amount == null) errors.push(product?.unit === "ml" ? "Quantità non valida (es. 1,5 l)" : "Peso non valido (es. 850 g, 1,2 kg)");
  return { product, priceFullCents, discountCents, pieces: Number.isNaN(pieces) ? null : pieces, amount, errors };
}

/**
 * Loads what the editor needs, then mounts it with its initial state (no state syncing in effects).
 * `scan`: review screen for the scan handed over by the receipts list (in memory only; gone after a reload).
 */
export function ReceiptEditPage({ scan: scanMode = false }: { scan?: boolean }) {
  const params = useParams();
  const receiptId = params.id ? Number(params.id) : null;
  const products = useProducts();
  const stores = useStores();
  const chains = useChains(); // the store form prefills the chain by name
  const existing = useReceipt(receiptId);
  const [scan] = useState(() => (scanMode ? getPendingScan() : null));

  if (scanMode && !scan) {
    return (
      <div className="empty">
        <p>La scansione non è più disponibile (la pagina è stata ricaricata). Scatta di nuovo la foto.</p>
        <Link to="/" className="button primary">
          Torna agli scontrini
        </Link>
      </div>
    );
  }
  const loading = products.isLoading || stores.isLoading || chains.isLoading || (receiptId != null && existing.isLoading);
  const loadError = products.error ?? stores.error ?? chains.error ?? existing.error;
  if (loading || loadError) return <QueryState isLoading={loading} error={loadError} />;
  return <ReceiptEditor key={receiptId ?? (scan ? "scan" : "new")} receipt={existing.data ?? null} scan={scan} />;
}

function ReceiptEditor({ receipt, scan }: { receipt: ReceiptDetail | null; scan: PendingScan | null }) {
  const receiptId = receipt?.id ?? null;
  const navigate = useNavigate();
  const scanned = scan?.result ?? null;

  const products = useProducts();
  const stores = useStores();
  const save = useSaveReceipt();
  const upload = useUploadReceiptPhoto();
  const remove = useDeleteReceipt();

  const [chosenStoreId, setStoreId] = useState<number | null>(receipt?.storeId ?? scanned?.store.storeId ?? null);
  const [date, setDate] = useState(receipt?.date ?? scanned?.date ?? todayRome());
  const [totalPrinted, setTotalPrinted] = useState(() => {
    const printed = receipt ? receipt.totalPrintedCents : (scanned?.totalCents ?? null);
    return printed != null ? centsToInput(printed) : "";
  });
  const [notes, setNotes] = useState(receipt?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    receipt ? linesFrom(receipt) : scanned ? linesFromScan(scanned) : [emptyLine()],
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [creatingProduct, setCreatingProduct] = useState<{ lineKey: number; name: string } | null>(null);
  const [creatingStore, setCreatingStore] = useState(false);
  const [focusKey, setFocusKey] = useState<number | null>(null);

  // New receipt: default to the most recently used store (stores come sorted by last use).
  // A scan never falls back silently: an unrecognized store must be chosen or created.
  const storeId = chosenStoreId ?? (scanned ? null : (stores.data?.[0]?.id ?? null));

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
  /** The user picked (or confirmed) this line's product: a scanned line no longer needs attention. */
  const chooseProduct = (key: number, productId: number, patch: Partial<Line> = {}) =>
    setLines((ls) =>
      ls.map((l) => (l.key === key ? { ...l, ...patch, productId, scan: l.scan && { ...l.scan, confirmed: true } } : l)),
    );

  function selectProduct(key: number, product: Product) {
    const line = lines.find((l) => l.key === key);
    const last = lastPriceByProduct.get(product.id);
    // Packaged products: prefill last time's price at this store (never overwriting what was typed).
    // Loose/per-piece products only get the "ultima volta" hint. Quantities are never carried over.
    const prefill = line && !line.price && last && shouldPrefillPrice(product);
    chooseProduct(key, product.id, prefill ? { price: centsToInput(last.priceFullCents) } : {});
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
      source: scanned ? "scan" : undefined,
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
    let savedId: number;
    try {
      savedId = (await save.mutateAsync({ ...input, id: receiptId ?? undefined })).id;
    } catch (err) {
      return setError(err);
    }
    if (!scan) return navigate("/");
    // The photo is stored only now, so abandoned scans leave nothing behind. If the upload fails the receipt
    // stays saved and its page offers to upload the photo again.
    try {
      await upload.mutateAsync({ id: savedId, photo: scan.photo });
      navigate("/");
    } catch {
      navigate(`/scontrini/${savedId}`, { replace: true, state: { photoFailed: true } });
    }
    setPendingScan(null);
  }

  const busy = save.isPending || upload.isPending;
  const sumMismatch = scanned && printedCents != null && invalidCount === 0 && printedCents !== totalCents;

  return (
    <form className="form receipt-form" onSubmit={submit} noValidate>
      <PageHeader
        title={receiptId ? "Modifica scontrino" : scan ? "Revisione scansione" : "Nuovo scontrino"}
        back={
          <Link to="/" className="back" aria-label="Indietro">
            ‹
          </Link>
        }
      />

      {scan && (
        <ScanNotices
          scan={scan}
          storeChosen={storeId != null}
          dateRead={scanned!.date != null}
          onCreateStore={() => setCreatingStore(true)}
        />
      )}
      {receiptId && !scan && <ReceiptPhoto receiptId={receiptId} hasPhoto={receipt!.hasPhoto} />}

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
            <li
              key={line.key}
              className={[
                "line",
                submitted && p.errors.length && !isBlank(line) ? "invalid" : "",
                line.scan && (needsConfirmation(line) || line.productId == null) ? "needs-action" : "",
              ].join(" ").trim()}
              data-testid="receipt-line"
            >
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
              {line.scan ? (
                <MatchInfo
                  line={line}
                  index={index}
                  onConfirm={() => chooseProduct(line.key, line.productId!)}
                  onCreate={() => setCreatingProduct({ lineKey: line.key, name: line.scan?.suggestedName ?? line.rawText ?? "" })}
                />
              ) : (
                line.rawText && <p className="muted small">Sullo scontrino: {line.rawText}</p>
              )}
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
                  <span className="muted" data-testid="last-price">
                    {lastPriceHint(last)}
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

      {sumMismatch && (
        <p className="notice warn" data-testid="sum-mismatch">
          La somma delle righe ({formatCents(totalCents)}) è diversa dal totale stampato ({formatCents(printedCents)}): controlla
          prezzi, sconti e righe mancanti.
        </p>
      )}
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
        <button type="submit" className="button primary" disabled={busy}>
          {save.isPending ? "Salvataggio…" : upload.isPending ? "Invio foto…" : "Salva"}
        </button>
      </div>

      <Dialog open={creatingProduct != null} title="Nuovo prodotto" onClose={() => setCreatingProduct(null)}>
        {creatingProduct && (
          <ProductForm
            initialName={creatingProduct.name}
            onCancel={() => setCreatingProduct(null)}
            onUseExisting={(id) => {
              chooseProduct(creatingProduct.lineKey, id);
              setCreatingProduct(null);
            }}
            onSaved={(id) => {
              // The save resolves after the product list has refetched, so the line can point at it right away.
              chooseProduct(creatingProduct.lineKey, id);
              setCreatingProduct(null);
            }}
          />
        )}
      </Dialog>
      <Dialog open={creatingStore} title="Nuovo negozio" onClose={() => setCreatingStore(false)}>
        <StoreForm
          initial={
            scanned && scanned.store.storeId == null
              ? { chainName: scanned.store.name, name: scanned.store.address, address: scanned.store.address, vatNumber: scanned.store.vatNumber }
              : undefined
          }
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

const STATUS: Record<MatchStatus | "confirmed", { label: string; tone: "ok" | "check" | "todo"; hint?: string }> = {
  confirmed: { label: "Confermato", tone: "ok" },
  alias: { label: "Riconosciuto", tone: "ok" },
  proposed: { label: "Proposto", tone: "check", hint: "controlla che sia il prodotto giusto" },
  uncertain: { label: "Incerto", tone: "todo" },
  none: { label: "Nuovo prodotto", tone: "todo" },
};

/** Scanned line: printed text, match status (in words, not only color) and the action it needs. */
function MatchInfo({ line, index, onConfirm, onCreate }: { line: Line; index: number; onConfirm: () => void; onCreate: () => void }) {
  const scan = line.scan!;
  const key = scan.confirmed ? "confirmed" : line.productId == null ? "none" : scan.status;
  const status = STATUS[key];
  return (
    <div className="match small" data-testid="match-info">
      <span className={`status ${status.tone}`} data-testid="match-status">
        {status.label}
      </span>
      <span className="muted">Sullo scontrino: {line.rawText}</span>
      {status.hint && <span className="muted">· {status.hint}</span>}
      {needsConfirmation(line) && (
        <button type="button" className="button" onClick={onConfirm} aria-label={`Confermo il prodotto della riga ${index + 1}`}>
          Confermo
        </button>
      )}
      {line.productId == null && (
        <button type="button" className="button" onClick={onCreate}>
          Crea «{scan.suggestedName ?? line.rawText}»
        </button>
      )}
    </div>
  );
}

/** What the review screen must flag before anything else: unknown store, unread date, text-only matching, the photo. */
function ScanNotices({
  scan,
  storeChosen,
  dateRead,
  onCreateStore,
}: {
  scan: PendingScan;
  storeChosen: boolean;
  dateRead: boolean;
  onCreateStore: () => void;
}) {
  const { store, aiMatching } = scan.result;
  const printed = [store.name, store.address, store.vatNumber && `P.IVA ${store.vatNumber}`].filter(Boolean).join(" · ");
  return (
    <>
      {store.status === "none" && !storeChosen && (
        <div className="notice warn" data-testid="store-unknown">
          Negozio non riconosciuto{printed ? `: ${printed}` : ""}. Sceglilo dall'elenco o crealo.
          <div className="actions">
            <button type="button" className="button" onClick={onCreateStore}>
              Crea negozio
            </button>
          </div>
        </div>
      )}
      {store.status === "chain" && (
        <p className="notice">Negozio riconosciuto dalla catena: controlla che il punto vendita sia quello giusto.</p>
      )}
      {!dateRead && <p className="notice warn">Data non leggibile sullo scontrino: controllala.</p>}
      {!aiMatching && (
        <p className="notice warn">
          Abbinamento AI non disponibile: le proposte vengono solo dalla somiglianza del testo, controllale con più attenzione.
        </p>
      )}
      <details className="details">
        <summary>Foto dello scontrino</summary>
        <img className="photo-thumb" src={scan.photoUrl} alt="Foto dello scontrino scansionato" />
      </details>
    </>
  );
}

/** Saved receipt: its stored photo (served only by the authenticated API), or a way to add/replace it. */
function ReceiptPhoto({ receiptId, hasPhoto }: { receiptId: number; hasPhoto: boolean }) {
  const location = useLocation();
  const upload = useUploadReceiptPhoto();
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0); // busts the browser cache after a replacement
  const failedAfterScan = (location.state as { photoFailed?: boolean } | null)?.photoFailed && !hasPhoto && version === 0;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      await upload.mutateAsync({ id: receiptId, photo: await compressReceiptPhoto(file) });
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="photo-section">
      {failedAfterScan && (
        <p className="notice warn" role="alert">
          Scontrino salvato, ma la foto non è stata caricata. Riprova qui sotto.
        </p>
      )}
      {hasPhoto && (
        <details className="details">
          <summary>Foto dello scontrino</summary>
          <a href={`/api/receipts/${receiptId}/photo?v=${version}`} target="_blank" rel="noreferrer">
            <img
              className="photo-thumb"
              src={`/api/receipts/${receiptId}/photo?v=${version}`}
              alt="Foto dello scontrino"
              loading="lazy"
            />
          </a>
        </details>
      )}
      <label className={upload.isPending ? "button disabled" : "button"}>
        {upload.isPending ? "Invio foto…" : hasPhoto ? "Sostituisci foto" : "📷 Aggiungi foto"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="visually-hidden"
          disabled={upload.isPending}
          aria-label="Foto dello scontrino"
          onChange={onFile}
        />
      </label>
      <ErrorText error={error} />
    </div>
  );
}
