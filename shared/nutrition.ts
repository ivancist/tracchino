// Nutrition values per 100 g / 100 ml: plausibility checks shown as warnings (never blocking: labels can be odd).

export type Nutrition = {
  kcal100: number | null;
  protein100: number | null;
  fat100: number | null;
  carbs100: number | null;
  sugars100: number | null;
};

export const NUTRITION_KEYS = ["kcal100", "protein100", "fat100", "carbs100", "sugars100"] as const;

/** kcal from macros (Atwater): 4 per g of protein and carbohydrate, 9 per g of fat. */
export const atwaterKcal = (n: { protein100: number; fat100: number; carbs100: number }) =>
  4 * n.protein100 + 9 * n.fat100 + 4 * n.carbs100;

/** Fibre (2 kcal/g), polyols and alcohol make labels drift from 4/9/4: tolerate 20% or 20 kcal, whichever is larger. */
const KCAL_TOLERANCE = 0.2;
const KCAL_TOLERANCE_ABS = 20;

export function nutritionWarnings(n: Nutrition): string[] {
  const out: string[] = [];
  const macros = [n.protein100, n.fat100, n.carbs100];
  if (macros.some((v) => v != null && v > 100)) out.push("Un macronutriente supera 100 g per 100 g");
  const known = macros.filter((v): v is number => v != null);
  if (known.length > 1 && known.reduce((s, v) => s + v, 0) > 100.5) {
    out.push("Proteine + grassi + carboidrati superano 100 g per 100 g");
  }
  if (n.sugars100 != null && n.carbs100 != null && n.sugars100 > n.carbs100 + 0.5) {
    out.push("Gli zuccheri superano i carboidrati");
  }
  if (n.kcal100 != null && n.protein100 != null && n.fat100 != null && n.carbs100 != null) {
    const expected = atwaterKcal({ protein100: n.protein100, fat100: n.fat100, carbs100: n.carbs100 });
    if (Math.abs(n.kcal100 - expected) > Math.max(KCAL_TOLERANCE_ABS, expected * KCAL_TOLERANCE)) {
      out.push(`Le kcal (${Math.round(n.kcal100)}) non tornano con i macronutrienti (≈ ${Math.round(expected)} kcal)`);
    }
  }
  return out;
}
