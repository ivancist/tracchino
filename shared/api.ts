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
  salt100: number | null;
  nutritionSource: "off" | "manual" | null;
  purchaseCount: number;
  lastPurchaseDate: string | null;
};

/** Last line bought for a product at a given store — used to prefill a new receipt line. */
export type LastPrice = {
  productId: number;
  priceFullCents: number;
  discountCents: number;
  packages: number | null;
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
  packages: number | null;
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

/** An entry of a past meal, with what's needed to show it and repeat it. */
export type PastMealItem = import("./diary").MealItem & {
  productName: string;
  productBrand: string | null;
  unit: ProductUnit;
  groupId: number | null;
  portionName: string | null;
  /** The portion's weight today (what repeating it will use); null without a portion or if it was deleted. */
  portionAmount: number | null;
};
/** A past meal; `dates` lists every day it was eaten exactly like this, newest first. */
export type PastMeal = { dates: string[]; items: PastMealItem[] };

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
  /** Packages bought: merged identical lines and "2 PZ x" quantity rows add up. */
  packages: number;
  /** Pieces in each package, when printed ("UOVA 6P" → 6). */
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

/** GET /api/shopping-list: a product to buy (packages if stated) or a free-text item. */
export type ShoppingListItem = {
  id: number;
  productId: number | null;
  /** Product name, or the free text. */
  name: string;
  brand: string | null;
  unit: ProductUnit | null;
  packageAmount: number | null;
  packages: number | null;
};

/** GET /api/pantry: a product bought, eaten in the last 30 days or with a stock correction — stock, forecast, suggestion, monthly use. */
export type PantryItem = {
  productId: number;
  name: string;
  brand: string | null;
  unit: ProductUnit;
  packageAmount: number | null;
  avgPieceAmount: number | null;
  /** Latest receipt line (raw: paid cents, packages, pieces, grams) — price per package or per kg at a glance. */
  lastPurchase: { date: string; paidCents: number; packages: number | null; pieces: number | null; amount: number | null } | null;
  /**
   * Consumption over the last 30 days: g/ml per logged day, on a typical day and in a typical meal it is eaten, logged days since first eaten
   * (under MIN_RATE_DAYS: no forecast nor monthly use) and days eaten. null when not eaten lately (stock corrected only).
   */
  rate: { perDay: number; typicalDay: number; typicalMeal: number; days: number; eatenDays: number } | null;
  /** null: never bought in the app nor corrected, or a purchase with unknown quantity. */
  stock: { amount: number; estimated: boolean; since: string; corrected: boolean } | null;
  forecast: { daysLeft: number; runOutDate: string; urgency: "finished" | "soon" | "week" | null } | null;
  suggestedPackages: number | null;
  packageEveryDays: number | null;
  packagesPerMonth: number | null;
  costPerMonthCents: number | null;
  costEstimated: boolean;
  inList: boolean;
};
