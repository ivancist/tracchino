-- "Peso medio a pezzo" and the "Pezzo" portion are the same thing. The owner set the weight on a "Pezzo" portion
-- (bananas 120 g, eggs 65 g…) while quantities read avg_piece_amount, which stayed empty: pieces bought had no weight.
UPDATE `products` SET `avg_piece_amount` = (
  SELECT po.`amount` FROM `portions` po
   WHERE po.`product_id` = `products`.`id` AND lower(trim(po.`name`)) IN ('pezzo', '1 pezzo')
   ORDER BY po.`id` LIMIT 1
) WHERE `avg_piece_amount` IS NULL
    AND EXISTS (SELECT 1 FROM `portions` po WHERE po.`product_id` = `products`.`id` AND lower(trim(po.`name`)) IN ('pezzo', '1 pezzo'));
--> statement-breakpoint
-- The other way round: a product with a piece weight gets its "Pezzo" portion for the diary.
INSERT INTO `portions` (`product_id`, `name`, `amount`)
SELECT p.`id`, 'Pezzo', p.`avg_piece_amount` FROM `products` p
 WHERE p.`avg_piece_amount` IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM `portions` po WHERE po.`product_id` = p.`id` AND lower(trim(po.`name`)) IN ('pezzo', '1 pezzo'));
