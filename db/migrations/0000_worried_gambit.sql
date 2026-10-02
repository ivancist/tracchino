CREATE TABLE `chains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chains_name_unique` ON `chains` (`name`);--> statement-breakpoint
CREATE TABLE `diary_entries` (
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
	CONSTRAINT "diary_entries_meal_chk" CHECK("diary_entries"."meal" in ('colazione', 'pranzo', 'cena', 'snack')),
	CONSTRAINT "diary_entries_amount_chk" CHECK("diary_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `diary_entries_date_idx` ON `diary_entries` (`date`);--> statement-breakpoint
CREATE INDEX `diary_entries_product_idx` ON `diary_entries` (`product_id`);--> statement-breakpoint
CREATE TABLE `portions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "portions_amount_chk" CHECK("portions"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `portions_product_idx` ON `portions` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chain_id` integer NOT NULL,
	`raw_text_norm` text NOT NULL,
	`product_id` integer NOT NULL,
	`confirmations` integer DEFAULT 1 NOT NULL,
	`last_seen` text NOT NULL,
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_aliases_chain_raw_uq` ON `product_aliases` (`chain_id`,`raw_text_norm`);--> statement-breakpoint
CREATE INDEX `product_aliases_product_idx` ON `product_aliases` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_groups_name_unique` ON `product_groups` (`name`);--> statement-breakpoint
CREATE TABLE `products` (
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
	CONSTRAINT "products_unit_chk" CHECK("products"."unit" in ('g', 'ml', 'pz')),
	CONSTRAINT "products_package_amount_chk" CHECK("products"."package_amount" is null or "products"."package_amount" > 0),
	CONSTRAINT "products_avg_piece_chk" CHECK("products"."avg_piece_amount" is null or "products"."avg_piece_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`);--> statement-breakpoint
CREATE INDEX `products_group_idx` ON `products` (`group_id`);--> statement-breakpoint
CREATE TABLE `receipt_items` (
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
	CONSTRAINT "receipt_items_paid_chk" CHECK("receipt_items"."price_paid_cents" = "receipt_items"."price_full_cents" - "receipt_items"."discount_cents"),
	CONSTRAINT "receipt_items_discount_chk" CHECK("receipt_items"."discount_cents" >= 0),
	CONSTRAINT "receipt_items_pieces_chk" CHECK("receipt_items"."pieces" is null or "receipt_items"."pieces" > 0),
	CONSTRAINT "receipt_items_amount_chk" CHECK("receipt_items"."amount" is null or "receipt_items"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `receipt_items_receipt_idx` ON `receipt_items` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_items_product_idx` ON `receipt_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`date` text NOT NULL,
	`total_printed_cents` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`photo_key` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "receipts_source_chk" CHECK("receipts"."source" in ('manual', 'scan'))
);
--> statement-breakpoint
CREATE INDEX `receipts_date_idx` ON `receipts` (`date`);--> statement-breakpoint
CREATE INDEX `receipts_store_idx` ON `receipts` (`store_id`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chain_id` integer NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`vat_number` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `stores_chain_idx` ON `stores` (`chain_id`);--> statement-breakpoint
CREATE INDEX `stores_vat_idx` ON `stores` (`vat_number`);