import { useMemo, useState } from "react";
import { Link } from "react-router";
import { formatIsoDate } from "../../shared/dates";
import { formatAmount } from "../../shared/quantity";
import { rankByQuery } from "../../shared/text";
import { GroupsSection } from "../components/GroupsSection";
import { productLabel } from "../components/ProductPicker";
import { PageHeader, QueryState } from "../components/ui";
import { useProducts } from "../queries";

export function ProductsPage() {
  const products = useProducts();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const all = products.data ?? [];
    return query.trim() ? rankByQuery(query, all, productLabel, () => 0, all.length) : all;
  }, [products.data, query]);

  return (
    <>
      <PageHeader
        title="Prodotti"
        action={
          <Link to="/prodotti/nuovo" className="button primary">
            + Nuovo
          </Link>
        }
      />
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
        {visible.map((p) => (
          <li key={p.id}>
            <Link to={`/prodotti/${p.id}`} className="list-item">
              <span>
                <strong>{p.name}</strong> {p.brand && <span className="muted">{p.brand}</span>}
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
        ))}
      </ul>
      {!query.trim() && <GroupsSection />}
    </>
  );
}
