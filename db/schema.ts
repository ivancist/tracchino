import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { PRODUCT_UNITS } from "../shared/types";

// Conventions: money in integer cents, quantities in integer grams/millilitres,
// dates as ISO `YYYY-MM-DD` text, unknown values NULL (never 0).

// SQLite has no date type: enforce the `YYYY-MM-DD` shape (calendar validity is checked by Zod).
const isoDateCheck = (name: string, column: AnySQLiteColumn) =>
  check(name, sql`${column} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`);

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);

export const chains = sqliteTable("chains", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

export const stores = sqliteTable(
  "stores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    address: text("address"),
    vatNumber: text("vat_number"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stores_chain_name_uq").on(t.chainId, t.name),
    index("stores_vat_idx").on(t.vatNumber),
  ],
);

export const productGroups = sqliteTable("product_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

export const NUTRITION_SOURCES = ["off", "manual"] as const;

export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").references(() => productGroups.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    brand: text("brand"),
    barcode: text("barcode").unique(),
    unit: text("unit", { enum: PRODUCT_UNITS }).notNull(),
    packageAmount: integer("package_amount"),
    avgPieceAmount: integer("avg_piece_amount"),
    kcal100: real("kcal_100"),
    protein100: real("protein_100"),
    fat100: real("fat_100"),
    carbs100: real("carbs_100"),
    sugars100: real("sugars_100"),
    nutritionSource: text("nutrition_source", { enum: NUTRITION_SOURCES }),
    createdAt: createdAt(),
  },
  (t) => [
    index("products_group_idx").on(t.groupId),
    check("products_unit_chk", sql`${t.unit} in ('g', 'ml', 'pz')`),
    check("products_package_amount_chk", sql`${t.packageAmount} is null or ${t.packageAmount} > 0`),
    check("products_avg_piece_chk", sql`${t.avgPieceAmount} is null or ${t.avgPieceAmount} > 0`),
    check("products_nutrition_source_chk", sql`${t.nutritionSource} is null or ${t.nutritionSource} in ('off', 'manual')`),
  ],
);

export const productAliases = sqliteTable(
  "product_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    rawTextNorm: text("raw_text_norm").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    confirmations: integer("confirmations").notNull().default(1),
    lastSeen: text("last_seen").notNull(),
  },
  (t) => [
    uniqueIndex("product_aliases_chain_raw_uq").on(t.chainId, t.rawTextNorm),
    index("product_aliases_product_idx").on(t.productId),
  ],
);

export const RECEIPT_SOURCES = ["manual", "scan"] as const;

export const receipts = sqliteTable(
  "receipts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    date: text("date").notNull(),
    totalPrintedCents: integer("total_printed_cents"),
    source: text("source", { enum: RECEIPT_SOURCES }).notNull().default("manual"),
    photoKey: text("photo_key"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("receipts_date_idx").on(t.date),
    index("receipts_store_idx").on(t.storeId),
    check("receipts_source_chk", sql`${t.source} in ('manual', 'scan')`),
    isoDateCheck("receipts_date_chk", t.date),
    check("receipts_total_chk", sql`${t.totalPrintedCents} is null or ${t.totalPrintedCents} >= 0`),
  ],
);

export const receiptItems = sqliteTable(
  "receipt_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    rawText: text("raw_text"),
    pieces: integer("pieces"),
    amount: integer("amount"),
    priceFullCents: integer("price_full_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    pricePaidCents: integer("price_paid_cents").notNull(),
  },
  (t) => [
    index("receipt_items_receipt_idx").on(t.receiptId),
    index("receipt_items_product_idx").on(t.productId),
    check("receipt_items_paid_chk", sql`${t.pricePaidCents} = ${t.priceFullCents} - ${t.discountCents}`),
    check("receipt_items_discount_chk", sql`${t.discountCents} >= 0`),
    check("receipt_items_full_chk", sql`${t.priceFullCents} >= 0`),
    check("receipt_items_paid_nonneg_chk", sql`${t.pricePaidCents} >= 0`),
    check("receipt_items_pieces_chk", sql`${t.pieces} is null or ${t.pieces} > 0`),
    check("receipt_items_amount_chk", sql`${t.amount} is null or ${t.amount} > 0`),
  ],
);

export const portions = sqliteTable(
  "portions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amount: integer("amount").notNull(),
  },
  (t) => [
    index("portions_product_idx").on(t.productId),
    check("portions_amount_chk", sql`${t.amount} > 0`),
  ],
);

export const MEALS = ["colazione", "pranzo", "cena", "snack"] as const;

export const diaryEntries = sqliteTable(
  "diary_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    meal: text("meal", { enum: MEALS }).notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    // Resolved grams/ml eaten (from direct input or portion × qty)
    amount: integer("amount").notNull(),
    portionId: integer("portion_id").references(() => portions.id, { onDelete: "set null" }),
    portionQty: real("portion_qty"),
    createdAt: createdAt(),
  },
  (t) => [
    index("diary_entries_date_idx").on(t.date),
    index("diary_entries_product_idx").on(t.productId),
    check("diary_entries_meal_chk", sql`${t.meal} in ('colazione', 'pranzo', 'cena', 'snack')`),
    check("diary_entries_amount_chk", sql`${t.amount} > 0`),
    isoDateCheck("diary_entries_date_chk", t.date),
  ],
);
