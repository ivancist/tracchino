import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatIsoDate } from "../../shared/dates";
import { formatAmount } from "../../shared/quantity";
import { rankByQuery } from "../../shared/text";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { GroupsSection } from "../components/GroupsSection";
import type { BarcodeStart } from "../components/ProductForm";
import { productLabel } from "../components/ProductPicker";
import { ApiError, errorMessage } from "../api";
import { ErrorText, PageHeader, QueryState } from "../components/ui";
import { storedCost } from "../costPreference";
import { isFinished, stockText } from "../pantryText";
import { lookupBarcode, usePantry, useProducts } from "../queries";

export function ProductsPage() {
  const products = useProducts();
  const [cost] = useState(storedCost);
  const pantry = usePantry(cost.mode, cost.windowDays);
  const stockById = useMemo(() => new Map((pantry.data ?? []).map((i) => [i.productId, i])), [pantry.data]);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [looking, setLooking] = useState(false);
  const [scanError, setScanError] = useState<unknown>(null);

  /** Known barcode → its product; unknown → new product, prefilled from Open Food Facts when it has the code. */
  async function onBarcode(code: string) {
    setScanning(false);
    setLooking(true);
    setScanError(null);
    try {
      const lookup = await lookupBarcode(code);
      if (lookup.existingProductId != null) return navigate(`/prodotti/${lookup.existingProductId}`);
      navigate("/prodotti/nuovo", { state: { barcode: { barcode: code, lookup } satisfies BarcodeStart } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        navigate("/prodotti/nuovo", { state: { barcode: { barcode: code, lookup: null, message: err.message } satisfies BarcodeStart } });
      } else {
        setScanError(errorMessage(err));
      }
    } finally {
      setLooking(false);
    }
  }

  const visible = useMemo(() => {
    const all = products.data ?? [];
    return query.trim() ? rankByQuery(query, all, productLabel, () => 0, all.length) : all;
  }, [products.data, query]);

  return (
    <>
      <PageHeader
        title="Prodotti"
        back={
          <Link to="/altro" className="back" aria-label="Indietro">
            ‹
          </Link>
        }
        action={
          <div className="actions">
            <button type="button" className="button" disabled={looking} onClick={() => setScanning(true)}>
              {looking ? "Ricerca…" : "📷 Barcode"}
            </button>
            <Link to="/prodotti/nuovo" className="button primary">
              + Nuovo
            </Link>
          </div>
        }
      />
      <ErrorText error={scanError} />
      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onDetected={onBarcode} />
      <input
        className="input search"
        type="search"
        placeholder="Cerca…"
        aria-label="Cerca prodotti"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <QueryState isLoading={products.isLoading} error={products.error} />
      {products.data?.length === 0 && <p className="muted">Nessun prodotto: si creano anche direttamente dallo scontrino.</p>}
      <ul className="list">
        {visible.map((p) => {
          const stock = stockById.get(p.id);
          return (
            <li key={p.id}>
              <Link to={`/prodotti/${p.id}`} className="list-item" data-testid="product-row">
                <span>
                  <strong>{p.name}</strong> {p.brand && <span className="muted">{p.brand}</span>}
                  {stock && isFinished(stock) && <span className="badge finished">Finito</span>}
                  <br />
                  <span className="muted small">
                    {[
                      p.groupName,
                      p.packageAmount ? formatAmount(p.packageAmount, p.unit === "ml" ? "ml" : "g") : null,
                      p.kcal100 != null ? `${p.kcal100} kcal` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {stock?.stock && !isFinished(stock) && (
                    <>
                      <br />
                      <span className="small">{stockText(stock)}</span>
                    </>
                  )}
                </span>
                <span className="muted small right">
                  {p.purchaseCount > 0 ? `${p.purchaseCount}×` : "mai comprato"}
                  {p.lastPurchaseDate && (
                    <>
                      <br />
                      {formatIsoDate(p.lastPurchaseDate)}
                    </>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {!query.trim() && <GroupsSection />}
    </>
  );
}
