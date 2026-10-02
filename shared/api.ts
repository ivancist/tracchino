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
