import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Created, Product } from "../../shared/api";
import { NUTRITION_KEYS as NUTRITION_KEY_LIST } from "../../shared/nutrition";
import { mergeInput, productInput } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { getDb, schema } from "../db";
import { HttpError, notFound, parseBody, parseId } from "../http";

const { products } = schema;

const PRODUCT_SELECT = `
  select p.id, p.name, p.brand, p.group_id as groupId, g.name as groupName, p.barcode, p.unit,
         p.package_amount as packageAmount, p.avg_piece_amount as avgPieceAmount,
         p.kcal_100 as kcal100, p.protein_100 as protein100, p.fat_100 as fat100,
         p.carbs_100 as carbs100, p.sugars_100 as sugars100,
         p.saturated_fat_100 as saturatedFat100, p.fiber_100 as fiber100, p.nutrition_source as nutritionSource,
         count(ri.id) as purchaseCount, max(r.date) as lastPurchaseDate
    from products p
    left join product_groups g on g.id = p.group_id
    left join receipt_items ri on ri.product_id = p.id
    left join receipts r on r.id = ri.receipt_id`;

const NUTRITION_KEYS = NUTRITION_KEY_LIST;
type NutritionKey = (typeof NUTRITION_KEYS)[number];

type ParsedProduct = ReturnType<typeof productInput.parse>;
type NutritionSource = "off" | "manual" | null;

/**
 * Nutrition source after a write: none → null; a fresh Open Food Facts import (declared by the client) or values
 * unchanged from a previous import → "off"; anything typed or edited by hand → "manual".
 */
function toRow(input: ParsedProduct, previous?: Pick<typeof products.$inferSelect, NutritionKey | "nutritionSource">) {
  const { nutritionSource: declared, ...values } = input;
  const hasNutrition = NUTRITION_KEYS.some((k) => values[k] != null);
  let nutritionSource: NutritionSource = hasNutrition ? "manual" : null;
  const unchangedImport = previous?.nutritionSource === "off" && NUTRITION_KEYS.every((k) => values[k] === previous[k]);
  if (hasNutrition && (declared === "off" || unchangedImport)) nutritionSource = "off";
  return { ...values, nutritionSource };
}

async function loadProduct(env: Env, id: number): Promise<Product | null> {
  return env.DB.prepare(`${PRODUCT_SELECT} where p.id = ? group by p.id`).bind(id).first<Product>();
}

export const productRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(`${PRODUCT_SELECT} group by p.id order by p.name collate nocase`).all<Product>();
    return c.json(results);
  })
  .get("/:id", async (c) => {
    const product = await loadProduct(c.env, parseId(c));
    if (!product) throw notFound("Prodotto non trovato");
    return c.json(product);
  })
  .post("/", async (c) => {
    const input = await parseBody(c, productInput);
    const [row] = await getDb(c.env).insert(products).values(toRow(input)).returning({ id: products.id });
    return c.json<Created>({ id: row!.id }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseId(c);
    const input = await parseBody(c, productInput);
    const db = getDb(c.env);
    const previous = await db.select().from(products).where(eq(products.id, id)).get();
    if (!previous) throw notFound("Prodotto non trovato");
    await db.update(products).set(toRow(input, previous)).where(eq(products.id, id));
    return c.json<Created>({ id });
  })
  .delete("/:id", async (c) => {
    // Fails with 409 if the product appears in receipts or the diary (FK restrict): merge it instead.
    const id = parseId(c);
    const [row] = await getDb(c.env).delete(products).where(eq(products.id, id)).returning({ id: products.id });
    if (!row) throw notFound("Prodotto non trovato");
    return c.body(null, 204);
  })
  /**
   * Merges product :id into `intoId`: every receipt line, diary entry, portion and alias moves to the target,
   * missing fields on the target (brand, barcode, sizes, nutrition) are filled from the source, then the source
   * is deleted. All in one D1 batch (atomic).
   */
  .post("/:id/merge", async (c) => {
    const fromId = parseId(c);
    const { intoId } = await parseBody(c, mergeInput);
    if (fromId === intoId) throw new HttpError(400, { error: "invalid_input", message: "Non puoi unire un prodotto con sé stesso" });

    const db = getDb(c.env);
    const [from, into] = await Promise.all([
      db.select().from(products).where(eq(products.id, fromId)).get(),
      db.select().from(products).where(eq(products.id, intoId)).get(),
    ]);
    if (!from || !into) throw notFound("Prodotto non trovato");
    // Quantities on the moved lines are in the source's unit: merging g into ml (or pieces) would corrupt them.
    if (from.unit !== into.unit) {
      throw new HttpError(400, { error: "invalid_input", message: "I due prodotti hanno unità diverse (peso, volume, pezzi): non si possono unire" });
    }

    const takeNutrition = into.nutritionSource == null && from.nutritionSource != null;
    const nutrition = takeNutrition ? from : into;
    const d1 = c.env.DB;
    await d1.batch([
      d1.prepare("update receipt_items set product_id = ?1 where product_id = ?2").bind(intoId, fromId),
      d1.prepare("update diary_entries set product_id = ?1 where product_id = ?2").bind(intoId, fromId),
      d1.prepare("update portions set product_id = ?1 where product_id = ?2").bind(intoId, fromId),
      // An alias the target already has for the same chain wins; the duplicate is dropped with the source (cascade).
      d1.prepare("update or ignore product_aliases set product_id = ?1 where product_id = ?2").bind(intoId, fromId),
      d1.prepare("delete from products where id = ?").bind(fromId),
      // Runs after the delete, so the source barcode is free to move to the target.
      d1
        .prepare(
          `update products set brand = ?, barcode = ?, package_amount = ?, avg_piece_amount = ?, group_id = ?,
                  kcal_100 = ?, protein_100 = ?, fat_100 = ?, carbs_100 = ?, sugars_100 = ?,
                  saturated_fat_100 = ?, fiber_100 = ?, nutrition_source = ?
            where id = ?`,
        )
        .bind(
          into.brand ?? from.brand,
          into.barcode ?? from.barcode,
          into.packageAmount ?? from.packageAmount,
          into.avgPieceAmount ?? from.avgPieceAmount,
          into.groupId ?? from.groupId,
          nutrition.kcal100,
          nutrition.protein100,
          nutrition.fat100,
          nutrition.carbs100,
          nutrition.sugars100,
          nutrition.saturatedFat100,
          nutrition.fiber100,
          nutrition.nutritionSource,
          intoId,
        ),
    ]);

    return c.json<Created>({ id: intoId });
  });
