import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { onSessionExpired } from "../api";

// The diary comes first; shopping holds the list and the receipts; products and stores live under "Altro".
const NAV = [
  { to: "/diario", label: "Diario", also: [] as string[] },
  { to: "/spesa", label: "Spesa", also: ["/scontrini"] },
  { to: "/statistiche", label: "Statistiche", also: [] },
  { to: "/altro", label: "Altro", also: ["/prodotti", "/negozi"] },
];

export function Layout() {
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => onSessionExpired(() => setSessionExpired(true)), []);
  const { pathname } = useLocation();

  return (
    <div className="app">
      {sessionExpired && (
        <div className="banner" role="alert">
          Sessione scaduta.{" "}
          <button type="button" className="link" onClick={() => window.location.reload()}>
            Accedi di nuovo
          </button>
        </div>
      )}
      <main className="page">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Sezioni">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive || item.also.some((p) => pathname.startsWith(p)) ? "tab active" : "tab")}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
