import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { addDays, formatIsoDate, formatShortDate, todayRome, weekStart } from "../../shared/dates";
import { formatCents } from "../../shared/money";
import { BarChart } from "../components/charts";
import { DietAnalysis } from "../components/DietAnalysis";
import { Field, PageHeader, QueryState } from "../components/ui";
import { useSpending, useTopProducts } from "../queries";

type Preset = "all" | "30d" | "12w" | "year" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "all", label: "Tutto" },
  { id: "30d", label: "30 giorni" },
  { id: "12w", label: "12 settimane" },
  { id: "year", label: "Quest'anno" },
  { id: "custom", label: "Date…" },
];

function presetRange(preset: Preset, today: string): { from?: string; to?: string } {
  switch (preset) {
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "12w":
      return { from: addDays(weekStart(today), -11 * 7), to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return {};
  }
}

/** Cents → "12 €" on axes (whole euros keep tick labels short). */
const axisEuro = (cents: number) => `${Math.round(cents / 100)} €`;

function Tile({ label, value, hint, hero }: { label: string; value: string; hint?: string; hero?: boolean }) {
  return (
    <div className={hero ? "tile hero" : "tile"}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {hint && <div className="tile-label">{hint}</div>}
    </div>
  );
}

const money = (cents: number | null) => (cents == null ? "—" : formatCents(cents));

export function StatsPage() {
  const today = todayRome();
  const [params, setParams] = useSearchParams();
  const view = params.get("vista") === "dieta" ? "dieta" : "spesa";
  const [preset, setPreset] = useState<Preset>("all");
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const range = preset === "custom" ? custom : presetRange(preset, today);
  const spending = useSpending(range.from, range.to, view === "spesa");
  const top = useTopProducts(range.from, range.to, view === "spesa");
  const s = spending.data;

  const maxTop = Math.max(1, ...(top.data ?? []).map((t) => t.totalCents));

  return (
    <>
      <PageHeader title="Statistiche" />
      <div className="segmented tabs" role="tablist" aria-label="Vista">
        <button type="button" role="tab" aria-selected={view === "spesa"} onClick={() => setParams({})}>
          Spesa
        </button>
        <button type="button" role="tab" aria-selected={view === "dieta"} onClick={() => setParams({ vista: "dieta" })}>
          Dieta
        </button>
      </div>
      <div className="chips" role="group" aria-label="Periodo">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="row">
          <Field label="Dal">
            <input className="input" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          </Field>
          <Field label="Al">
            <input className="input" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </Field>
        </div>
      )}

      {view === "dieta" ? (
        <DietAnalysis from={range.from} to={range.to} />
      ) : (
        <>
          <QueryState isLoading={spending.isLoading} error={spending.error} />
          {s && s.firstReceiptDate == null && (
            <div className="empty">
              <p>Le statistiche compaiono dopo il primo scontrino.</p>
              <Link to="/scontrini/nuovo" className="button primary">
                Inserisci uno scontrino
              </Link>
            </div>
          )}
          {s && s.firstReceiptDate != null && (
            <>
              <p className="muted small">
                {formatIsoDate(s.from)} → {formatIsoDate(s.to)} · {s.daily.count} giorni, giorni senza spesa inclusi
              </p>
              <div className="tiles" data-testid="stats-tiles">
                <Tile hero label="Speso nel periodo" value={formatCents(s.totalCents)} hint={`Totale storico ${formatCents(s.allTimeTotalCents)}`} />
                <Tile label="Media al giorno" value={money(s.daily.mean)} />
                <Tile label="Mediana al giorno" value={money(s.daily.median)} />
                <Tile
                  label="Media a settimana"
                  value={money(s.weekly.mean)}
                  hint={`${s.weekly.count === 1 ? "1 settimana" : `${s.weekly.count} settimane`}${s.weekly.partial ? `, ${s.weekly.partial} parzial${s.weekly.partial === 1 ? "e" : "i"}` : ""}`}
                />
                <Tile label="Mediana a settimana" value={money(s.weekly.median)} />
              </div>

              {s.weeks.length > 1 && (
                <BarChart
                  title="Spesa per settimana"
                  format={axisEuro}
                  formatExact={formatCents}
                  reference={s.weekly.median != null ? { value: s.weekly.median, label: "mediana" } : null}
                  bars={s.weeks.map((w) => ({
                    key: w.weekStart,
                    label: formatShortDate(w.weekStart),
                    value: w.totalCents,
                    muted: !w.complete,
                    tooltip: `Settimana dal ${formatShortDate(w.weekStart)} · ${formatCents(w.totalCents)}${w.complete ? "" : " (parziale)"}`,
                  }))}
                />
              )}
              {s.days.length > 92 && (
                <p className="muted small">Il grafico per giorno è disponibile per periodi fino a 3 mesi.</p>
              )}
              {s.days.length <= 92 && (
                <BarChart
                  title="Spesa per giorno"
                  format={axisEuro}
                  formatExact={formatCents}
                  reference={s.daily.median ? { value: s.daily.median, label: "mediana" } : null}
                  bars={s.days.map((d) => ({
                    key: d.date,
                    label: String(Number(d.date.slice(8))),
                    value: d.totalCents,
                    tooltip: `${formatIsoDate(d.date)} · ${formatCents(d.totalCents)}`,
                  }))}
                />
              )}

              <section className="day">
                <h2 className="day-title">Dove vanno i soldi</h2>
                <QueryState isLoading={top.isLoading} error={top.error} />
                <ul className="list" data-testid="top-products">
                  {top.data?.map((t) => (
                    <li key={t.productId}>
                      <Link to={`/prodotti/${t.productId}`} className="rank-row">
                        <span className="rank-top">
                          <span>
                            <strong>{t.name}</strong> {t.brand && <span className="muted">{t.brand}</span>}
                          </span>
                          <strong>{formatCents(t.totalCents)}</strong>
                        </span>
                        <span className="muted small">
                          {t.purchases === 1 ? "1 acquisto" : `${t.purchases} acquisti`}
                          {t.avgIntervalDays != null && ` · circa ogni ${Math.round(t.avgIntervalDays)} giorni`}
                        </span>
                        <div className="rowbar" style={{ width: `${(t.totalCents / maxTop) * 100}%` }} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
