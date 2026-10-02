import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { onSessionExpired } from "../api";

const NAV = [
  { to: "/", label: "Scontrini", end: true },
  { to: "/statistiche", label: "Statistiche", end: false },
  { to: "/prodotti", label: "Prodotti", end: false },
  { to: "/negozi", label: "Negozi", end: false },
  { to: "/account", label: "Account", end: false },
];

export function Layout() {
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => onSessionExpired(() => setSessionExpired(true)), []);

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
          <NavLink key={item.to} to={item.to} end={item.end} className="tab">
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
