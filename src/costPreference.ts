import { COST_MODES, COST_WINDOW_DAYS, COST_WINDOWS, type CostMode } from "../shared/diary";

// How diary costs are computed (per device: a convenience, the server takes it as query parameters).

export type CostPref = { mode: CostMode; windowDays: number };
const KEY = "tracchino.diary.cost";
export const DEFAULT_COST: CostPref = { mode: "average", windowDays: COST_WINDOW_DAYS };

export const costLabel = (p: CostPref) =>
  p.mode === "average" ? `media degli acquisti degli ultimi ${p.windowDays} giorni` : "ultimo prezzo pagato";

/** Storage can be unavailable (private mode): fall back to the default. */
export function storedCost(): CostPref {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CostPref> | null;
    const mode = COST_MODES.includes(v?.mode as CostMode) ? (v!.mode as CostMode) : DEFAULT_COST.mode;
    const windowDays = (COST_WINDOWS as readonly number[]).includes(v?.windowDays as number) ? v!.windowDays! : DEFAULT_COST.windowDays;
    return { mode, windowDays };
  } catch {
    return DEFAULT_COST;
  }
}

export function saveCost(p: CostPref) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // not persisted: fine
  }
}
