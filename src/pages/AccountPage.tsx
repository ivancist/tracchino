import { Link } from "react-router";
import { AccountButton } from "../components/AccountButton";
import { PageHeader } from "../components/ui";

const SECTIONS = [
  { to: "/prodotti", title: "Prodotti", hint: "Catalogo, scorte, prezzi, porzioni e valori nutrizionali" },
  { to: "/negozi", title: "Negozi e catene", hint: "Punti vendita, P.IVA per riconoscerli dagli scontrini" },
];

export function AccountPage() {
  return (
    <>
      <PageHeader title="Altro" action={<AccountButton />} />
      <ul className="list">
        {SECTIONS.map((s) => (
          <li key={s.to}>
            <Link to={s.to} className="list-item">
              <span>
                <strong>{s.title}</strong>
                <br />
                <span className="muted small">{s.hint}</span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
