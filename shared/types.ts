// Domain enums shared by the DB schema, Zod schemas and the UI.
export const PRODUCT_UNITS = ["g", "ml", "pz"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const UNIT_LABELS: Record<ProductUnit, string> = {
  g: "a peso (g)",
  ml: "a volume (ml)",
  pz: "a pezzi (uova, cespi… indichi quanti nella riga)",
};
