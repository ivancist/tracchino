ALTER TABLE `receipt_items` ADD `packages` integer;--> statement-breakpoint
-- Until now `pieces` meant two things. Scanned lines are one printed item each: 1 package, and their pieces were typed as
-- the pieces inside it (carrots 500 g → 6). Manual lines of packaged products used pieces as the package count (2 × pasta).
UPDATE `receipt_items` SET `packages` = 1
 WHERE `receipt_id` IN (SELECT `id` FROM `receipts` WHERE `source` = 'scan');--> statement-breakpoint
UPDATE `receipt_items` SET `packages` = `pieces`, `pieces` = NULL
 WHERE `packages` IS NULL AND `pieces` IS NOT NULL
   AND `product_id` IN (SELECT `id` FROM `products` WHERE `package_amount` IS NOT NULL);--> statement-breakpoint
-- Default "Confezione" portion for packaged products (g/ml) that don't have one yet.
INSERT INTO `portions` (`product_id`, `name`, `amount`)
SELECT p.`id`, 'Confezione', p.`package_amount` FROM `products` p
 WHERE p.`package_amount` IS NOT NULL AND p.`unit` IN ('g', 'ml')
   AND NOT EXISTS (SELECT 1 FROM `portions` po WHERE po.`product_id` = p.`id` AND lower(trim(po.`name`)) = 'confezione');
