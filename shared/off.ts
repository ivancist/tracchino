import { nutritionWarnings, type Nutrition } from "./nutrition";

// Open Food Facts product (API v2) → prefill for a Tracchino product. Pure: tested on hand-written responses.
// The data is crowd-sourced: everything is optional, numbers can be strings, values can be wrong.

/** Fields requested from OFF (keeps responses small). */
export const OFF_FIELDS = [
  "product_name",
  "product_name_it",
  "generic_name_it",
  "brands",
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "nutriments",
] as const;

export type OffRawProduct = Partial<Record<(typeof OFF_FIELDS)[number], unknown>>;

export type OffPrefill = {
  barcode: string;
  name: string | null;
  brand: string | null;
  unit: "g" | "ml";
  /** Grams or millilitres per package. */
  packageAmount: number | null;
  nutrition: Nutrition;
  /** Values present on OFF but discarded as impossible, and plausibility warnings. */
  warnings: string[];
};

const KJ_PER_KCAL = 4.184;

function num(v: unknown): number | null {
  // Number("") is 0: an empty string on OFF means "not given", never zero.
  if (typeof v === "string" && !v.trim()) return null;
  const n = typeof v === "string" ? Number(v.trim().replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

const VOLUME_UNITS: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000, lt: 1000, litro: 1000, litri: 1000 };
const MASS_UNITS: Record<string, number> = { g: 1, gr: 1, grammi: 1, kg: 1000, mg: 0.001 };

/**
 * Package size from the structured fields, else from the label text: "500 g", "1,5 L", "33cl", "6 x 125 g" (= 750 g).
 */
function packageSize(p: OffRawProduct): { unit: "g" | "ml"; amount: number | null } {
  const structuredUnit = typeof p.product_quantity_unit === "string" ? p.product_quantity_unit.toLowerCase() : null;
  const structured = num(p.product_quantity);
  if (structured != null && structured > 0 && (structuredUnit === "g" || structuredUnit === "ml")) {
    return { unit: structuredUnit, amount: Math.round(structured) };
  }
  const label =
    typeof p.quantity === "string"
      ? p.quantity
          .toLowerCase()
          // Italian thousands separator before a small unit: "1.000 g" is 1000 g, not 1 g
          .replace(/(\d)\.(\d{3})(?=\s*(?:g|gr|grammi|ml)\b)/g, "$1$2")
          .replace(",", ".")
      : "";
  const m = /(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|mg|grammi|gr|g|ml|cl|dl|litri|litro|lt|l)\b/.exec(label);
  if (!m) return { unit: structuredUnit === "ml" ? "ml" : "g", amount: null };
  const count = m[1] ? Number(m[1]) : 1;
  const value = Number(m[2]) * count;
  const u = m[3]!;
  const volume = VOLUME_UNITS[u];
  const amount = Math.round(value * (volume ?? MASS_UNITS[u]!));
  return { unit: volume != null ? "ml" : "g", amount: amount > 0 ? amount : null };
}

export function mapOffProduct(barcode: string, p: OffRawProduct): OffPrefill {
  const n = (typeof p.nutriments === "object" && p.nutriments ? p.nutriments : {}) as Record<string, unknown>;
  const warnings: string[] = [];

  // Energy: kcal when given, else kJ converted (OFF's plain "energy_100g" is always kJ).
  let kcal = num(n["energy-kcal_100g"]);
  if (kcal == null) {
    const kj = num(n["energy-kj_100g"]) ?? num(n["energy_100g"]);
    if (kj != null) kcal = kj / KJ_PER_KCAL;
  }
  const keep = (value: number | null, max: number, label: string, decimals: number) => {
    if (value == null) return null;
    if (value < 0 || value > max) {
      warnings.push(`${label} su Open Food Facts non plausibile (${value}): scartato`);
      return null;
    }
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
  };
  const nutrition: Nutrition = {
    kcal100: keep(kcal, 900, "Energia", 0),
    protein100: keep(num(n.proteins_100g), 100, "Proteine", 1),
    fat100: keep(num(n.fat_100g), 100, "Grassi", 1),
    carbs100: keep(num(n.carbohydrates_100g), 100, "Carboidrati", 1),
    sugars100: keep(num(n.sugars_100g), 100, "Zuccheri", 1),
  };
  const size = packageSize(p);
  const brand = typeof p.brands === "string" ? text(p.brands.split(",")[0], 80) : null;

  return {
    barcode,
    name: text(p.product_name_it, 120) ?? text(p.product_name, 120) ?? text(p.generic_name_it, 120),
    brand,
    unit: size.unit,
    packageAmount: size.amount,
    nutrition,
    warnings: [...warnings, ...nutritionWarnings(nutrition)],
  };
}
