import { NavLink } from "react-router";

/** "Spesa": the list and the receipts, as two addresses (back button and bookmarks work). */
export function ShoppingTabs() {
  return (
    <nav className="segmented tabs" aria-label="Spesa">
      <NavLink to="/spesa" end>
        Lista
      </NavLink>
      <NavLink to="/spesa/scontrini" end>
        Scontrini
      </NavLink>
    </nav>
  );
}
