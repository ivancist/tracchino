import { useState } from "react";
import type { PantryItem, Product, ShoppingListItem } from "../../shared/api";
import { ProductPicker } from "../components/ProductPicker";
import { ShoppingTabs } from "../components/ShoppingTabs";
import { ErrorText, PageHeader, QueryState } from "../components/ui";
import { storedCost } from "../costPreference";
import { grams, productTitle as label, stockText } from "../pantryText";
import { useAddShoppingItem, useDeleteShoppingItem, usePantry, useProducts, useShoppingList, useUpdateShoppingItem } from "../queries";

type Urgency = NonNullable<NonNullable<PantryItem["forecast"]>["urgency"]>;
const URGENCY: { id: Urgency; title: string }[] = [
  { id: "finished", title: "Finiti" },
  { id: "soon", title: "Finiscono entro 2 giorni" },
  { id: "week", title: "Finiscono entro una settimana" },
];

function Packages({ value, onChange, name }: { value: number | null; onChange: (v: number | null) => void; name: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const commit = () => {
    const n = text.trim() === "" ? null : Number(text);
    if (n === null || (Number.isInteger(n) && n >= 1 && n <= 99)) {
      if (n !== value) onChange(n);
    } else setText(value == null ? "" : String(value));
  };
  return (
    <input
      className="input packages-input"
      inputMode="numeric"
      aria-label={`Confezioni di ${name}`}
      placeholder="conf."
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function Suggestion({ item }: { item: PantryItem }) {
  const add = useAddShoppingItem();
  const [packages, setPackages] = useState(item.suggestedPackages);
  return (
    <li className="shopping-row" data-testid="suggestion">
      <div className="shopping-main">
        <strong>{label(item)}</strong>
        <div className="muted small">{stockText(item)}</div>
      </div>
      {item.packageAmount != null && <Packages value={packages} onChange={setPackages} name={label(item)} />}
      <button
        type="button"
        className="button"
        disabled={add.isPending}
        onClick={() => add.mutate({ productId: item.productId, packages: item.packageAmount != null ? packages : null })}
      >
        + Aggiungi
      </button>
    </li>
  );
}

function ListRow({ item }: { item: ShoppingListItem }) {
  const update = useUpdateShoppingItem();
  const remove = useDeleteShoppingItem();
  return (
    <li className="shopping-row" data-testid="shopping-item">
      <div className="shopping-main">
        <strong>{label(item)}</strong>
        {item.packageAmount != null && <div className="muted small">confezione da {grams(item.packageAmount, item.unit)}</div>}
      </div>
      {item.productId != null && (
        <Packages key={item.packages ?? "none"} value={item.packages} onChange={(packages) => update.mutate({ id: item.id, packages })} name={label(item)} />
      )}
      <button type="button" className="icon-button" aria-label={`Preso: ${label(item)}`} disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>
        ✓
      </button>
    </li>
  );
}

function AddItem({ products }: { products: Product[] }) {
  const add = useAddShoppingItem();
  const [text, setText] = useState("");
  return (
    <div className="card">
      <ProductPicker label="Aggiungi un prodotto" products={products} value={null} onSelect={(p) => add.mutate({ productId: p.id })} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate({ name: text }, { onSuccess: () => setText("") });
        }}
      >
        <input className="input" aria-label="Altro da comprare" placeholder="Altro (es. candele)" value={text} onChange={(e) => setText(e.target.value)} maxLength={120} />
        <button type="submit" className="button" disabled={!text.trim() || add.isPending}>
          Aggiungi
        </button>
      </form>
      {add.error && <ErrorText error={add.error} />}
    </div>
  );
}

export function ShoppingPage() {
  const [cost] = useState(storedCost);
  const pantry = usePantry(cost.mode, cost.windowDays);
  const list = useShoppingList();
  const products = useProducts();
  const suggestions = (pantry.data ?? []).filter((i) => i.forecast?.urgency != null && !i.inList);

  return (
    <>
      <PageHeader title="Spesa" />
      <ShoppingTabs />
      <section aria-labelledby="to-buy">
        <h2 id="to-buy">Da comprare</h2>
        <QueryState isLoading={list.isLoading} error={list.error} />
        {list.data?.length === 0 && <p className="muted">La lista è vuota.</p>}
        <ul className="shopping-list">
          {list.data?.map((item) => <ListRow key={item.id} item={item} />)}
        </ul>
        {products.data && <AddItem products={products.data} />}
        <p className="muted small">Salvando uno scontrino, i prodotti comprati (anche di un'altra marca dello stesso gruppo) escono dalla lista.</p>
      </section>

      <section aria-labelledby="suggested">
        <h2 id="suggested">Suggeriti</h2>
        <QueryState isLoading={pantry.isLoading} error={pantry.error} />
        {pantry.data && suggestions.length === 0 && <p className="muted">Niente sta per finire, secondo scorte e diario.</p>}
        {URGENCY.map((u) => {
          const group = suggestions.filter((s) => s.forecast!.urgency === u.id);
          return (
            group.length > 0 && (
              <div key={u.id} data-testid={`urgency-${u.id}`}>
                <h3 className="small">{u.title}</h3>
                <ul className="shopping-list">
                  {group.map((item) => <Suggestion key={item.productId} item={item} />)}
                </ul>
              </div>
            )
          );
        })}
      </section>
    </>
  );
}
