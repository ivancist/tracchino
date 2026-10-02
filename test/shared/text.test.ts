import { describe, expect, it } from "vitest";
import { matchScore, normalizeText, rankByQuery } from "../../shared/text";

describe("normalizeText", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalizeText("  Banane  Chiquità! ")).toBe("banane chiquita");
    expect(normalizeText("BAN.CHIQ.")).toBe("ban chiq");
    expect(normalizeText("Caffè d'orzo")).toBe("caffe d orzo");
  });
});

describe("matchScore", () => {
  it("matches token prefixes in any order", () => {
    expect(matchScore("ban chiq", "banane chiquita")).toBeGreaterThan(0.7);
    expect(matchScore("chiq ban", "banane chiquita")).toBeGreaterThan(0.7);
  });
  it("tolerates typos through trigrams, with a lower score", () => {
    const typo = matchScore("bananne", "banane");
    expect(typo).toBeGreaterThan(0);
    expect(typo).toBeLessThan(matchScore("bana", "banane"));
  });
  it("rejects unrelated text", () => {
    expect(matchScore("latte", "banane chiquita")).toBe(0);
  });
});

describe("rankByQuery", () => {
  const items = [
    { name: "Banane Chiquita", freq: 0.1 },
    { name: "Banane bio Coop", freq: 1 },
    { name: "Latte intero", freq: 0.5 },
    { name: "Pane integrale", freq: 0.2 },
  ];
  const rank = (q: string) => rankByQuery(q, items, (i) => i.name, (i) => i.freq).map((i) => i.name);

  it("returns only matches, best first", () => {
    expect(rank("chiq")).toEqual(["Banane Chiquita"]);
    expect(rank("latte")).toEqual(["Latte intero"]);
  });
  it("uses frequency to break near-ties", () => {
    expect(rank("banane")[0]).toBe("Banane bio Coop");
  });
  it("lists most frequent first for an empty query", () => {
    expect(rank("")).toEqual(["Banane bio Coop", "Latte intero", "Pane integrale", "Banane Chiquita"]);
  });
});
