DROP INDEX `stores_chain_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `stores_chain_name_uq` ON `stores` (`chain_id`,`name`);--> statement-breakpoint
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_diary_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`product_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`portion_id` integer,
	`portion_qty` real,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`portion_id`) REFERENCES `portions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "diary_entries_meal_chk" CHECK("__new_diary_entries"."meal" in ('colazione', 'pranzo', 'cena', 'snack')),
	CONSTRAINT "diary_entries_amount_chk" CHECK("__new_diary_entries"."amount" > 0),
	CONSTRAINT "diary_entries_date_chk" CHECK("__new_diary_entries"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
INSERT INTO `__new_diary_entries`("id", "date", "meal", "product_id", "amount", "portion_id", "portion_qty", "created_at") SELECT "id", "date", "meal", "product_id", "amount", "portion_id", "portion_qty", "created_at" FROM `diary_entries`;--> statement-breakpoint
DROP TABLE `diary_entries`;--> statement-breakpoint
ALTER TABLE `__new_diary_entries` RENAME TO `diary_entries`;--> statement-breakpoint
CREATE INDEX `diary_entries_date_idx` ON `diary_entries` (`date`);--> statement-breakpoint
CREATE INDEX `diary_entries_product_idx` ON `diary_entries` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer,
	`name` text NOT NULL,
	`brand` text,
	`barcode` text,
	`unit` text NOT NULL,
	`package_amount` integer,
	`avg_piece_amount` integer,
	`kcal_100` real,
	`protein_100` real,
	`fat_100` real,
	`carbs_100` real,
	`sugars_100` real,
	`nutrition_source` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `product_groups`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "products_unit_chk" CHECK("__new_products"."unit" in ('g', 'ml', 'pz')),
	CONSTRAINT "products_package_amount_chk" CHECK("__new_products"."package_amount" is null or "__new_products"."package_amount" > 0),
	CONSTRAINT "products_avg_piece_chk" CHECK("__new_products"."avg_piece_amount" is null or "__new_products"."avg_piece_amount" > 0),
	CONSTRAINT "products_nutrition_source_chk" CHECK("__new_products"."nutrition_source" is null or "__new_products"."nutrition_source" in ('off', 'manual'))
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "group_id", "name", "brand", "barcode", "unit", "package_amount", "avg_piece_amount", "kcal_100", "protein_100", "fat_100", "carbs_100", "sugars_100", "nutrition_source", "created_at") SELECT "id", "group_id", "name", "brand", "barcode", "unit", "package_amount", "avg_piece_amount", "kcal_100", "protein_100", "fat_100", "carbs_100", "sugars_100", "nutrition_source", "created_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`);--> statement-breakpoint
CREATE INDEX `products_group_idx` ON `products` (`group_id`);--> statement-breakpoint
CREATE TABLE `__new_receipt_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`raw_text` text,
	`pieces` integer,
	`amount` integer,
	`price_full_cents` integer NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`price_paid_cents` integer NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "receipt_items_paid_chk" CHECK("__new_receipt_items"."price_paid_cents" = "__new_receipt_items"."price_full_cents" - "__new_receipt_items"."discount_cents"),
	CONSTRAINT "receipt_items_discount_chk" CHECK("__new_receipt_items"."discount_cents" >= 0),
	CONSTRAINT "receipt_items_full_chk" CHECK("__new_receipt_items"."price_full_cents" >= 0),
	CONSTRAINT "receipt_items_paid_nonneg_chk" CHECK("__new_receipt_items"."price_paid_cents" >= 0),
	CONSTRAINT "receipt_items_pieces_chk" CHECK("__new_receipt_items"."pieces" is null or "__new_receipt_items"."pieces" > 0),
	CONSTRAINT "receipt_items_amount_chk" CHECK("__new_receipt_items"."amount" is null or "__new_receipt_items"."amount" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_receipt_items`("id", "receipt_id", "product_id", "raw_text", "pieces", "amount", "price_full_cents", "discount_cents", "price_paid_cents") SELECT "id", "receipt_id", "product_id", "raw_text", "pieces", "amount", "price_full_cents", "discount_cents", "price_paid_cents" FROM `receipt_items`;--> statement-breakpoint
DROP TABLE `receipt_items`;--> statement-breakpoint
ALTER TABLE `__new_receipt_items` RENAME TO `receipt_items`;--> statement-breakpoint
CREATE INDEX `receipt_items_receipt_idx` ON `receipt_items` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_items_product_idx` ON `receipt_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`date` text NOT NULL,
	`total_printed_cents` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`photo_key` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "receipts_source_chk" CHECK("__new_receipts"."source" in ('manual', 'scan')),
	CONSTRAINT "receipts_date_chk" CHECK("__new_receipts"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "receipts_total_chk" CHECK("__new_receipts"."total_printed_cents" is null or "__new_receipts"."total_printed_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_receipts`("id", "store_id", "date", "total_printed_cents", "source", "photo_key", "notes", "created_at") SELECT "id", "store_id", "date", "total_printed_cents", "source", "photo_key", "notes", "created_at" FROM `receipts`;--> statement-breakpoint
DROP TABLE `receipts`;--> statement-breakpoint
ALTER TABLE `__new_receipts` RENAME TO `receipts`;--> statement-breakpoint
CREATE INDEX `receipts_date_idx` ON `receipts` (`date`);--> statement-breakpoint
CREATE INDEX `receipts_store_idx` ON `receipts` (`store_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys = off;
