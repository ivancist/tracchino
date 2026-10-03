import { describe, expect, it } from "vitest";
import { cleanBarcode, isValidGtin, normalizeGtin } from "../../shared/barcode";
import { nutritionWarnings } from "../../shared/nutrition";
import { mapOffProduct } from "../../shared/off";

describe("isValidGtin", () => {
  it.each([
    ["4006381333931", true], // EAN-13
    // 8 0 0 1 2 3 4 5 6 7 8 9 → weighted sum from the right 103 → check digit 7
    ["8001234567897", true],
    ["8001234567893", false],
    ["96385074", true], // EAN-8
    ["036000291452", true], // UPC-A
    ["04252614", true], // UPC-E (= UPC-A 042100005264)
    ["10012345678902", true], // GTIN-14
    ["123", false],
    ["800123456789A", false],
    ["0000000000000", true], // valid checksum, still digits only
    ["123456789", false], // 9 digits: not a GTIN length
  ])("%s → %s", (code, ok) => {
    expect(isValidGtin(code)).toBe(ok);
  });

  it("expands UPC-E to its 13-digit form, leaves the rest alone", () => {
    expect(normalizeGtin("04252614")).toBe("0042100005264");
    expect(isValidGtin("0042100005264")).toBe(true);
    expect(normalizeGtin("96385074")).toBe("96385074"); // a valid EAN-8 stays
    expect(normalizeGtin("4006381333931")).toBe("4006381333931");
  });

  it("rejects lengths that are not GTINs", () => {
    for (const code of ["1234567890", "12345678901", "123456789012345"]) expect(isValidGtin(code)).toBe(false);
  });

  it("cleans spaces and dashes", () => {
    expect(cleanBarcode(" 8 001234-567897 ")).toBe("8001234567897");
  });
});

describe("nutritionWarnings", () => {
  const n = (v: Partial<Parameters<typeof nutritionWarnings>[0]>) => ({
    kcal100: null,
    protein100: null,
    fat100: null,
    carbs100: null,
    sugars100: null,
    ...v,
  });

  it("accepts consistent values (4·10 + 9·10 + 4·30 = 250 kcal)", () => {
    expect(nutritionWarnings(n({ kcal100: 250, protein100: 10, fat100: 10, carbs100: 30, sugars100: 5 }))).toEqual([]);
  });

  it("kcal tolerance: 20% of the Atwater estimate, at least 20 kcal", () => {
    const base = { protein100: 10, fat100: 10, carbs100: 30 }; // 250 kcal → ±50
    expect(nutritionWarnings(n({ ...base, kcal100: 300 }))).toEqual([]);
    expect(nutritionWarnings(n({ ...base, kcal100: 200 }))).toEqual([]);
    expect(nutritionWarnings(n({ ...base, kcal100: 301 }))).toEqual(["Le kcal (301) non tornano con i macronutrienti (≈ 250 kcal)"]);
    const lean = { protein100: 10, fat100: 0, carbs100: 0 }; // 40 kcal → ±20
    expect(nutritionWarnings(n({ ...lean, kcal100: 60 }))).toEqual([]);
    expect(nutritionWarnings(n({ ...lean, kcal100: 61 }))).toHaveLength(1);
  });

  it("flags impossible macros", () => {
    expect(nutritionWarnings(n({ protein100: 60, fat100: 30, carbs100: 20 }))).toEqual([
      "Proteine + grassi + carboidrati superano 100 g per 100 g",
    ]);
    expect(nutritionWarnings(n({ protein100: 120 }))).toEqual(["Un macronutriente supera 100 g per 100 g"]);
    expect(nutritionWarnings(n({ carbs100: 10, sugars100: 12 }))).toEqual(["Gli zuccheri superano i carboidrati"]);
    expect(nutritionWarnings(n({ carbs100: 10, sugars100: 10.5 }))).toEqual([]); // rounding on labels
  });

  it("skips the kcal check when a macro is missing", () => {
    expect(nutritionWarnings(n({ kcal100: 900, protein100: 1, fat100: 1 }))).toEqual([]);
  });
});

describe("mapOffProduct", () => {
  it("maps a complete product", () => {
    const p = mapOffProduct("8001234567897", {
      product_name_it: "Passata di pomodoro",
      product_name: "Tomato passata",
      brands: "Mutti, Parma",
      quantity: "700 g",
      product_quantity: 700,
      product_quantity_unit: "g",
      nutriments: { "energy-kcal_100g": 36, proteins_100g: 1.6, fat_100g: 0.2, carbohydrates_100g: 6.2, sugars_100g: 4.5 },
    });
    expect(p).toEqual({
      barcode: "8001234567897",
      name: "Passata di pomodoro",
      brand: "Mutti",
      unit: "g",
      packageAmount: 700,
      nutrition: { kcal100: 36, protein100: 1.6, fat100: 0.2, carbs100: 6.2, sugars100: 4.5 },
      warnings: [],
    });
  });

  it("handles a product with nothing but its barcode", () => {
    expect(mapOffProduct("96385074", {})).toEqual({
      barcode: "96385074",
      name: null,
      brand: null,
      unit: "g",
      packageAmount: null,
      nutrition: { kcal100: null, protein100: null, fat100: null, carbs100: null, sugars100: null },
      warnings: [],
    });
  });

  it("converts kJ to kcal when kcal is missing (1046 kJ / 4.184 = 250 kcal)", () => {
    const p = mapOffProduct("1", { nutriments: { energy_100g: 1046, proteins_100g: 10, fat_100g: 10, carbohydrates_100g: 30 } });
    expect(p.nutrition.kcal100).toBe(250);
    expect(p.warnings).toEqual([]);
    expect(mapOffProduct("1", { nutriments: { "energy-kj_100g": 418.4, energy_100g: 999 } }).nutrition.kcal100).toBe(100);
    // kcal wins over kJ
    expect(mapOffProduct("1", { nutriments: { "energy-kcal_100g": 52, energy_100g: 218 } }).nutrition.kcal100).toBe(52);
  });

  it.each([
    [{ quantity: "1,5 L" }, "ml", 1500],
    [{ quantity: "33cl" }, "ml", 330],
    [{ quantity: "6 x 125 g" }, "g", 750],
    [{ quantity: "1 kg" }, "g", 1000],
    [{ product_quantity: "500", product_quantity_unit: "ml", quantity: "0,5 l" }, "ml", 500],
    [{ quantity: "2 pezzi" }, "g", null],
    [{ quantity: "1.000 g" }, "g", 1000], // Italian thousands separator
    [{ quantity: "1 litro" }, "ml", 1000],
    [{ quantity: "500 grammi" }, "g", 500],
    [{ quantity: "1.5 kg" }, "g", 1500],
  ])("package size %j → %s %s", (raw, unit, amount) => {
    expect(mapOffProduct("1", raw)).toMatchObject({ unit, packageAmount: amount });
  });

  it("reads numbers sent as strings with a decimal comma, rounds macros to 0.1 g and kcal to 1", () => {
    const p = mapOffProduct("1", { nutriments: { proteins_100g: "12,46", "energy-kcal_100g": "99.6" } });
    expect(p.nutrition).toMatchObject({ protein100: 12.5, kcal100: 100 });
  });

  it("treats empty strings as missing, never as 0", () => {
    const p = mapOffProduct("1", { nutriments: { proteins_100g: "", fat_100g: "  ", "energy-kcal_100g": "", energy_100g: 418.4 } });
    expect(p.nutrition).toMatchObject({ protein100: null, fat100: null, kcal100: 100 });
    expect(mapOffProduct("1", { product_quantity: "", quantity: "33cl" })).toMatchObject({ unit: "ml", packageAmount: 330 });
  });

  it("discards impossible values with a warning, and flags implausible ones", () => {
    const p = mapOffProduct("1", { nutriments: { fat_100g: 250, proteins_100g: -1 } });
    expect(p.nutrition).toMatchObject({ fat100: null, protein100: null });
    expect(p.warnings).toEqual([
      "Proteine su Open Food Facts non plausibile (-1): scartato",
      "Grassi su Open Food Facts non plausibile (250): scartato",
    ]);
    const odd = mapOffProduct("1", { nutriments: { "energy-kcal_100g": 500, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 } });
    expect(odd.warnings).toEqual(["Le kcal (500) non tornano con i macronutrienti (≈ 17 kcal)"]);
  });

  it("falls back to the generic name and trims the brand list", () => {
    expect(mapOffProduct("1", { product_name: "Yogurt greco", brands: " Fage " })).toMatchObject({ name: "Yogurt greco", brand: "Fage" });
    expect(mapOffProduct("1", { product_name: "", generic_name_it: "Latte" })).toMatchObject({ name: "Latte" });
  });
});
