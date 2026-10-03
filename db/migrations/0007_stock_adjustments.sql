CREATE TABLE `stock_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "stock_adjustments_date_chk" CHECK("stock_adjustments"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "stock_adjustments_amount_chk" CHECK("stock_adjustments"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `stock_adjustments_product_idx` ON `stock_adjustments` (`product_id`);