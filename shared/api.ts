import type { Frequency, PriceMetric, PurchaseLine, SpendingSummary, StorePriceStats } from "./stats";
import type { ProductUnit } from "./types";

// Response shapes of the API (hand-written; the Worker builds objects of these types).

export type MeResponse = { email: string; db: "ok" | "error" };

export type ApiErrorBody = {
  error: "unauthorized" | "invalid_input" | "not_found" | "conflict" | "in_use" | "internal_error";
  message?: string;
  issues?: { path: (string | number)[]; message: string }[];
};

export type Chain = { id: number; name: string; storeCount: number };

export type Store = {
  id: number;
  chainId: number;
  chainName: string;
  name: string;
  address: string | null;
  vatNumber: string | null;
  receiptCount: number;
  lastReceiptDate: string | null;
};

export type ProductGroup = { id: number; name: string; productCount: number };

export type Product = {
  id: number;
  name: string;
  brand: string | null;
  groupId: number | null;
  groupName: string | null;
  barcode: string | null;
  unit: ProductUnit;
  packageAmount: number | null;
  avgPieceAmount: number | null;
  kcal100: number | null;
  protein100: number | null;
  fat100: number | null;
  carbs100: number | null;
  sugars100: number | null;
  saturatedFat100: number | null;
  fiber100: number | null;
  nutritionSource: "off" | "manual" | null;
  purchaseCount: number;
  lastPurchaseDate: string | null;
};

/** Last line bought for a product at a given store — used to prefill a new receipt line. */
export type LastPrice = {
  productId: number;
  priceFullCents: number;
  discountCents: number;
  pieces: number | null;
  amount: number | null;
  date: string;
};

export type ReceiptSummary = {
  id: number;
  date: string;
  storeId: number;
  storeName: string;
  chainName: string;
  itemCount: number;
  totalCents: number;
  totalPrintedCents: number | null;
  source: "manual" | "scan";
};

export type ReceiptItem = {
  id: number;
  productId: number;
  productName: string;
  productBrand: string | null;
  unit: ProductUnit;
  packageAmount: number | null;
  avgPieceAmount: number | null;
  rawText: string | null;
  pieces: number | null;
  amount: number | null;
  priceFullCents: number;
  discountCents: number;
  pricePaidCents: number;
};

export type ReceiptDetail = Omit<ReceiptSummary, "itemCount" | "totalCents"> & {
  notes: string | null;
  hasPhoto: boolean;
  totalCents: number;
  items: ReceiptItem[];
};

export type Created = { id: number };

export type SpendingStats = SpendingSummary & {
  allTimeTotalCents: number;
  firstReceiptDate: string | null;
};

export type PurchaseRow = PurchaseLine & {
  receiptId: number;
  productId: number;
  productName: string;
  priceFullCents: number;
  discountCents: number;
};

export type PriceStats = {
  /** Metric used to rank stores: €/kg (or €/l when `volume`) or €/piece. */
  metric: PriceMetric;
  volume: boolean;
  /** True when only the most recent MAX purchases were analysed. */
  truncated: boolean;
  frequency: Frequency;
  byStore: StorePriceStats[];
  /** Newest first */
  purchases: PurchaseRow[];
};

export type TopProduct = {
  productId: number;
  name: string;
  brand: string | null;
  totalCents: number;
  purchases: number;
  days: number;
  avgIntervalDays: number | null;
};

/** GET /api/off/:barcode: a product already in the catalog, or a prefill from Open Food Facts. */
export type OffLookup =
  | { existingProductId: number; prefill: null }
  | { existingProductId: null; prefill: import("./off").OffPrefill };

export type Portion = { id: number; productId: number; name: string; amount: number };

export type DiaryEntry = {
  id: number;
  date: string;
  meal: import("./diary").Meal;
  productId: number;
  productName: string;
  productBrand: string | null;
  unit: ProductUnit;
  /** g or ml eaten. */
  amount: number;
  portionId: number | null;
  portionName: string | null;
  portionQty: number | null;
  nutrients: import("./diary").Nutrients;
  /** null = unknown (never bought, or no purchase with a known quantity), never 0. */
  costCents: number | null;
  costSource: "average" | "last" | null;
  costEstimated: boolean;
};

export type DiaryDay = {
  date: string;
  costMode: import("./diary").CostMode;
  windowDays: number;
  entries: DiaryEntry[];
  totals: Record<import("./diary").Nutrient, import("./diary").Total>;
  cost: import("./diary").Total;
};

/** Products eaten recently, most used first: the diary's autocomplete puts them on top. */
export type FrequentProduct = { productId: number; uses: number; lastDate: string };

export type ProductAnalysis = import("./analysis").ConsumptionRow & {
  name: string;
  brand: string | null;
  unit: ProductUnit;
  /** Cost of 100 kcal / 10 g of protein, at the end of the period. */
  per100KcalCents: number | null;
  per10gProteinCents: number | null;
  costEstimated: boolean;
};

export type DietAnalysis = {
  from: string;
  to: string;
  firstDiaryDate: string | null;
  summary: import("./analysis").DietSummary;
  products: ProductAnalysis[];
};

export type SimulationResult = import("./analysis").Simulation & { from: string; to: string; loggedDays: number };

export type MatchStatus = "alias" | "proposed" | "uncertain" | "none";

export type ScanLine = {
  rawText: string;
  rawTextNorm: string;
  priceCents: number;
  discountCents: number;
  pieces: number | null;
  amount: number | null;
  productId: number | null;
  status: MatchStatus;
  candidates: { productId: number; score: number }[];
  suggestedName: string | null;
};

export type ScanResult = {
  model: string;
  /** False when the AI second pass failed or was skipped: matches come from text similarity only. */
  aiMatching: boolean;
  store: {
    name: string | null;
    address: string | null;
    vatNumber: string | null;
    storeId: number | null;
    status: "vat" | "chain" | "none";
  };
  date: string | null;
  totalCents: number | null;
  lines: ScanLine[];
  /** Scans left today under the safety cap. */
  scansLeft: number;
};
