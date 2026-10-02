import { useEffect, useRef, useState, type ReactNode } from "react";

/** Measures the container width so the SVG is drawn at real pixels (text never stretches). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 0 and a "nice" max (1, 2, 2.5, 5 × 10^n) with `ticks` gridlines. */
function niceScale(max: number, ticks = 3): number[] {
  if (max <= 0) return [0];
  const rough = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

const PAD = { top: 12, right: 8, bottom: 24, left: 52 };

function ChartFrame({ title, table, children }: { title: string; table: ReactNode; children: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span>{title}</span>
        <button type="button" className="link small" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? "Grafico" : "Tabella"}
        </button>
      </figcaption>
      {showTable ? <div className="chart-table">{table}</div> : children}
    </figure>
  );
}

export type Bar = { key: string; label: string; value: number; tooltip: string; muted?: boolean };

/** Single-series bar chart (one hue), optional reference line (e.g. median), hover/tap tooltip. */
export function BarChart({
  title,
  bars,
  format,
  formatExact = format,
  reference,
  height = 180,
}: {
  title: string;
  bars: Bar[];
  /** Axis ticks (can be rounded) */
  format: (v: number) => string;
  /** Table view and accessible summary (exact) */
  formatExact?: (v: number) => string;
  reference?: { value: number; label: string } | null;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...bars.map((b) => b.value), reference?.value ?? 0);
  const ticks = niceScale(max);
  const top = ticks.at(-1) || 1;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = bars.length ? plotW / bars.length : 0;
  const barW = Math.max(1, Math.min(band - 2, band * 0.72)); // ≥ 2px surface gap between bars
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor(plotW / 56))));

  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((clientX - rect.left - PAD.left) / band);
    setActive(i >= 0 && i < bars.length ? i : null);
  };
  const activeBar = active != null ? bars[active] : undefined;

  const table = (
    <table>
      <tbody>
        {bars.map((b) => (
          <tr key={b.key}>
            <th scope="row">{b.tooltip.split(" · ")[0]}</th>
            <td>{formatExact(b.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame title={title} table={table}>
      <div ref={ref} className="chart-plot" onPointerLeave={() => setActive(null)}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${title}: ${bars.length} valori, massimo ${formatExact(Math.max(0, ...bars.map((b) => b.value)))}`}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {format(t)}
                </text>
              </g>
            ))}
            {bars.map((b, i) => {
              const x = PAD.left + i * band + (band - barW) / 2;
              const h = Math.max(0, PAD.top + plotH - y(b.value));
              const r = Math.min(4, barW / 2, h);
              const yTop = PAD.top + plotH - h;
              // Rounded data-end (top), square base on the axis
              const d = h > 0
                ? `M${x},${PAD.top + plotH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${PAD.top + plotH} Z`
                : "";
              return (
                <g key={b.key}>
                  {d && <path d={d} className={`bar${b.muted ? " muted" : ""}${active === i ? " active" : ""}`} />}
                  {i % labelEvery === 0 && (
                    <text className="axis" x={x + barW / 2} y={height - 6} textAnchor="middle">
                      {b.label}
                    </text>
                  )}
                </g>
              );
            })}
            {reference && reference.value > 0 && (
              <g>
                <line className="reference" x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)} />
                <text className="axis reference-label" x={width - PAD.right} y={y(reference.value) - 4} textAnchor="end">
                  {reference.label} {format(reference.value)}
                </text>
              </g>
            )}
          </svg>
        )}
        {activeBar && (
          <div
            className="tooltip"
            role="status"
            style={{ left: Math.min(Math.max(PAD.left + (active! + 0.5) * band, 70), width - 70), top: 0 }}
          >
            {activeBar.tooltip}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

export type Dot = { key: string; date: string; value: number; series: number; tooltip: string };

/** Unit price over time, one categorical color per series. At most 3 series (the palette validates all-pairs only up to 3). */
export function DotChart({
  title,
  dots,
  series,
  format,
  height = 200,
}: {
  title: string;
  dots: Dot[];
  series: string[];
  format: (v: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<Dot | null>(null);
  if (dots.length === 0) return null;

  const times = dots.map((d) => Date.parse(d.date));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const ticks = niceScale(Math.max(...dots.map((d) => d.value)));
  const top = ticks.at(-1) || 1;
  const plotW = Math.max(0, width - PAD.left - PAD.right - 12);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (date: string) => PAD.left + 6 + (t1 === t0 ? plotW / 2 : ((Date.parse(date) - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });

  const nearest = (clientX: number, clientY: number, rect: DOMRect) => {
    let best: Dot | null = null;
    let bestDist = 24 ** 2; // hit radius larger than the mark
    for (const d of dots) {
      const dist = (x(d.date) - (clientX - rect.left)) ** 2 + (y(d.value) - (clientY - rect.top)) ** 2;
      if (dist < bestDist) [best, bestDist] = [d, dist];
    }
    setActive(best);
  };

  const table = (
    <table>
      <tbody>
        {dots.map((d) => (
          <tr key={d.key}>
            <th scope="row">{d.tooltip.split(" · ").slice(0, 2).join(" · ")}</th>
            <td>{format(d.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame title={title} table={table}>
      {series.length > 1 && (
        <ul className="legend">
          {series.map((s, i) => (
            <li key={s}>
              <span className={`swatch s${i + 1}`} aria-hidden="true" />
              {s}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="chart-plot" onPointerLeave={() => setActive(null)}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${title}: ${dots.length} acquisti`}
            onPointerMove={(e) => nearest(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())}
            onPointerDown={(e) => nearest(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {format(t)}
                </text>
              </g>
            ))}
            <text className="axis" x={PAD.left + 6} y={height - 6}>
              {fmtDate(t0)}
            </text>
            {t1 !== t0 && (
              <text className="axis" x={width - PAD.right} y={height - 6} textAnchor="end">
                {fmtDate(t1)}
              </text>
            )}
            {dots.map((d) => (
              <circle
                key={d.key}
                cx={x(d.date)}
                cy={y(d.value)}
                r={active?.key === d.key ? 7 : 5}
                className={`dot s${d.series + 1}`}
              />
            ))}
          </svg>
        )}
        {active && (
          <div className="tooltip" role="status" style={{ left: Math.min(Math.max(x(active.date), 80), width - 80), top: 0 }}>
            {active.tooltip}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
