import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { onSessionExpired } from "../api";

// Five tabs fit at 360px; stores and account live under "Altro".
const NAV = [
  { to: "/", label: "Scontrini", end: true },
  { to: "/diario", label: "Diario", end: false },
  { to: "/statistiche", label: "Statistiche", end: false },
  { to: "/prodotti", label: "Prodotti", end: false },
  { to: "/account", label: "Altro", end: false, also: ["/negozi"] },
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
            end={item.end}
            className={({ isActive }) => (isActive || item.also?.some((p) => pathname.startsWith(p)) ? "tab active" : "tab")}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
