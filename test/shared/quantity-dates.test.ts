import { describe, expect, it } from "vitest";
import { isValidIsoDate, todayRome } from "../../shared/dates";
import { formatAmount, parseAmount } from "../../shared/quantity";

describe("parseAmount", () => {
  it.each([
    ["500", "g", 500],
    ["500g", "g", 500],
    ["1,2 kg", "g", 1200],
    ["1.25kg", "g", 1250],
    ["0,856 kg", "g", 856],
    ["330 ml", "ml", 330],
    ["1,5 l", "ml", 1500],
    ["75cl", "ml", 750],
    ["120", "pz", 120],
  ] as const)("%s (%s) → %i", (input, unit, expected) => {
    expect(parseAmount(input, unit)).toBe(expected);
  });

  it.each([
    ["", "g"],
    ["0", "g"],
    ["-5", "g"],
    ["abc", "g"],
    ["1 l", "g"], // volume suffix on a weight product
    ["1 kg", "ml"], // weight suffix on a volume product
  ] as const)("rejects %j for %s", (input, unit) => {
    expect(parseAmount(input, unit)).toBeNull();
  });
});

describe("formatAmount", () => {
  it("uses kg/l above 1000", () => {
    expect(formatAmount(1200, "g")).toBe("1,2 kg");
    expect(formatAmount(500, "g")).toBe("500 g");
    expect(formatAmount(1500, "ml")).toBe("1,5 l");
    expect(formatAmount(330, "ml")).toBe("330 ml");
  });
});

describe("todayRome", () => {
  it("is already the next day at 00:30 in Italy while UTC is still the previous day", () => {
    // 2026-10-01T22:30Z = 2026-10-02 00:30 CEST
    expect(todayRome(new Date("2026-10-01T22:30:00Z"))).toBe("2026-10-02");
  });
  it("handles winter time (CET, UTC+1)", () => {
    expect(todayRome(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(todayRome(new Date("2026-12-31T22:59:00Z"))).toBe("2026-12-31");
  });
});

describe("isValidIsoDate", () => {
  it.each(["2026-10-02", "2024-02-29", "2026-12-31"])("accepts %s", (d) => expect(isValidIsoDate(d)).toBe(true));
  it.each(["2026-02-29", "2026-13-01", "2026-04-31", "2026-1-1", "02/10/2026", ""])("rejects %j", (d) =>
    expect(isValidIsoDate(d)).toBe(false),
  );
});
