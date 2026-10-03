CREATE TABLE `shopping_list_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer,
	`name` text,
	`packages` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shopping_list_items_what_chk" CHECK("shopping_list_items"."product_id" is not null or "shopping_list_items"."name" is not null),
	CONSTRAINT "shopping_list_items_packages_chk" CHECK("shopping_list_items"."packages" is null or "shopping_list_items"."packages" > 0)
);
--> statement-breakpoint
CREATE INDEX `shopping_list_items_product_idx` ON `shopping_list_items` (`product_id`);