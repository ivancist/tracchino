import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, parseEuroToCents } from "../../shared/money";

describe("parseEuroToCents", () => {
  it.each([
    ["1,89", 189],
    ["1.89", 189],
    ["1,8", 180],
    ["1", 100],
    ["0,05", 5],
    ["€ 2", 200],
    ["  12,30 ", 1230],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1.234", 123400],
    ["0", 0],
    ["2 €", 200],
  ])("%s → %i", (input, cents) => {
    expect(parseEuroToCents(input)).toBe(cents);
  });

  it.each(["", "  ", "abc", "-1,00", "1,234", "1,2,3", "1.2.3", "1e3", ",50x"])("rejects %j", (input) => {
    expect(parseEuroToCents(input)).toBeNull();
  });

  it("never loses a cent to floating point", () => {
    // 0.29 * 100 = 28.999999999999996 in floating point
    expect(parseEuroToCents("0,29")).toBe(29);
    expect(parseEuroToCents("1,15")).toBe(115);
  });
});

describe("formatting", () => {
  it("formats cents as euros, Italian style", () => {
    expect(formatCents(189).replace(/\s/g, " ")).toBe("1,89 €");
    // it-IT omits the thousands separator for 4-digit numbers depending on ICU data: accept both
    expect(formatCents(123456)).toMatch(/^1\.?234,56\s€$/);
  });

  it("round-trips through the input format", () => {
    for (const cents of [0, 5, 189, 1230, 123456]) {
      expect(parseEuroToCents(centsToInput(cents))).toBe(cents);
    }
  });
});
