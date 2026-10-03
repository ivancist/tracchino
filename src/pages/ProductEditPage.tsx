import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import type { Product } from "../../shared/api";
import { PriceSection } from "../components/PriceSection";
import { PackageSummary, StockSection } from "../components/ProductOverview";
import { PortionsSection } from "../components/PortionsSection";
import { ProductForm, type BarcodeStart } from "../components/ProductForm";
import { ProductPicker, productLabel } from "../components/ProductPicker";
import { ConfirmButton, ErrorText, PageHeader, QueryState } from "../components/ui";
import { useDeleteProduct, useMergeProduct, useProducts } from "../queries";

export function ProductEditPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const location = useLocation();
  // New product opened from a barcode scan on the products list (lookup already done there).
  const start = id == null ? ((location.state as { barcode?: BarcodeStart } | null)?.barcode ?? undefined) : undefined;
  const products = useProducts();
  const remove = useDeleteProduct();
  const merge = useMergeProduct();
  const [target, setTarget] = useState<Product | null>(null);
  const [error, setError] = useState<unknown>(null);

  const product = id != null ? products.data?.find((p) => p.id === id) : undefined;
  const back = (
    <Link to="/prodotti" className="back" aria-label="Indietro">
      ‹
    </Link>
  );

  if (products.isLoading || products.error) return <QueryState isLoading={products.isLoading} error={products.error} />;
  if (id != null && !product) return <p className="error">Prodotto non trovato.</p>;

  return (
    <>
      <PageHeader title={product ? productLabel(product) : "Nuovo prodotto"} back={back} />
      {product && (
        <>
          <PackageSummary product={product} />
          <StockSection product={product} />
          <PriceSection product={product} />
          <PortionsSection product={product} />
          <h2 className="section-title">Dati del prodotto</h2>
        </>
      )}
      <ProductForm
        key={product?.id ?? `new-${start?.barcode ?? ""}`}
        product={product}
        start={start}
        onSaved={() => navigate("/prodotti")}
        onUseExisting={(existingId) => navigate(`/prodotti/${existingId}`)}
      />

      {product && (
        <section className="card danger-zone">
          <h2>Duplicato?</h2>
          <p className="muted small">
            Unisci questo prodotto a un altro: scontrini e dati passano al prodotto scelto, poi questo viene eliminato.
          </p>
          <ProductPicker
            label="Unisci a"
            products={(products.data ?? []).filter((p) => p.id !== product.id)}
            value={target}
            onSelect={setTarget}
          />
          {target && target.unit !== product.unit && (
            <p className="error small">Unità diverse (peso / volume / pezzi): questi due prodotti non si possono unire.</p>
          )}
          <div className="actions">
            <ConfirmButton
              // Re-mount when the target changes, so an armed confirmation never applies to a different product.
              key={target?.id ?? "none"}
              label={target ? `Unisci a «${target.name}»` : "Unisci"}
              confirmLabel={target ? `Conferma: unisci a «${target.name}»` : "Conferma"}
              disabled={!target || target.unit !== product.unit || merge.isPending}
              onConfirm={() =>
                merge.mutateAsync({ fromId: product.id, intoId: target!.id }).then(() => navigate(`/prodotti/${target!.id}`), setError)
              }
            />
            <ConfirmButton
              label="Elimina prodotto"
              confirmLabel="Conferma eliminazione"
              disabled={remove.isPending}
              onConfirm={() =>
                remove.mutateAsync(product.id).then(
                  () => navigate("/prodotti"),
                  (err: unknown) =>
                    setError(
                      product.purchaseCount > 0 ? "È presente in alcuni scontrini: uniscilo a un altro prodotto invece di eliminarlo." : err,
                    ),
                )
              }
            />
          </div>
          <ErrorText error={error} />
        </section>
      )}
    </>
  );
}
