import { useId, useMemo, useState } from "react";
import type { Product } from "../../shared/api";
import { normalizeText, rankByQuery } from "../../shared/text";

export function productLabel(p: Pick<Product, "name" | "brand">) {
  return p.brand ? `${p.name} · ${p.brand}` : p.name;
}

type Props = {
  products: Product[];
  value: Product | null;
  onSelect: (product: Product) => void;
  /** Omit to hide the "+ Crea" entry (e.g. when picking a merge target). */
  onCreate?: (name: string) => void;
  autoFocus?: boolean;
  label?: string;
};

/** Combobox: fuzzy search over products (frequent ones first), with a "create" entry for new products. */
export function ProductPicker({ products, value, onSelect, onCreate, autoFocus, label = "Prodotto" }: Props) {
  const [query, setQuery] = useState<string | null>(null); // null = showing the selected value
  const [active, setActive] = useState(0);
  const listId = useId();

  const maxCount = useMemo(() => Math.max(1, ...products.map((p) => p.purchaseCount)), [products]);
  const text = query ?? (value ? productLabel(value) : "");
  const open = query !== null;
  const matches = useMemo(
    () => (open ? rankByQuery(query, products, productLabel, (p) => p.purchaseCount / maxCount, 8) : []),
    [open, query, products, maxCount],
  );
  // Only offer to create a name that has letters/digits ("%%" would normalize to nothing).
  // Not when a product with exactly this name already exists (that would only make a duplicate).
  const normalizedQuery = open ? normalizeText(query) : "";
  const canCreate =
    open && onCreate != null && normalizedQuery.length > 0 && !matches.some((p) => normalizeText(p.name) === normalizedQuery);
  const optionCount = matches.length + (canCreate ? 1 : 0);

  function choose(index: number) {
    const product = matches[index];
    if (product) onSelect(product);
    else if (canCreate) onCreate?.(query.trim());
    setQuery(null);
  }

  return (
    <div className="combobox">
      <input
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={open && optionCount > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={onCreate ? "Cerca o crea un prodotto…" : "Cerca un prodotto…"}
        value={text}
        onFocus={(e) => {
          // Empty: show suggestions right away. Already chosen (or focus restored after a dialog): keep the
          // value visible and select it, so typing replaces it.
          if (value) e.target.select();
          else setQuery((q) => q ?? "");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, optionCount - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && optionCount > 0) {
            e.preventDefault();
            choose(active);
          } else if (e.key === "Escape") {
            setQuery(null);
          }
        }}
      />
      {open && optionCount > 0 && (
        <ul className="options" id={listId} role="listbox">
          {matches.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? "option active" : "option"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span>{productLabel(p)}</span>
              {p.purchaseCount > 0 && <span className="muted small">{p.purchaseCount}×</span>}
            </li>
          ))}
          {canCreate && (
            <li
              role="option"
              aria-selected={active === matches.length}
              className={active === matches.length ? "option create active" : "option create"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(matches.length)}
            >
              + Crea «{query.trim()}»
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
