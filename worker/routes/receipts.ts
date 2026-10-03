import { Hono } from "hono";
import type { Created, ReceiptDetail, ReceiptItem, ReceiptSummary } from "../../shared/api";
import { todayRome } from "../../shared/dates";
import { pricePaidCents } from "../../shared/pricing";
import { normalizeRawText } from "../../shared/receipt-text";
import { receiptInput, receiptListQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { IMAGE_TYPES, notFound, parseBody, parseId, parseImage, parseQuery, type ImageType } from "../http";

type ReceiptBody = ReturnType<typeof receiptInput.parse>;

const SUMMARY_SELECT = `
  select r.id, r.date, r.store_id as storeId, s.name as storeName, ch.name as chainName,
         r.total_printed_cents as totalPrintedCents, r.source, r.notes, r.photo_key as photoKey,
         count(ri.id) as itemCount, coalesce(sum(ri.price_paid_cents), 0) as totalCents
    from receipts r
    join stores s on s.id = r.store_id
    join chains ch on ch.id = s.chain_id
    left join receipt_items ri on ri.receipt_id = r.id`;

/**
 * Item inserts for a receipt. `receiptIdSql` is either a bound id or, for a receipt created in the same batch,
 * the last autoincrement value of `receipts` (D1 batches run sequentially in one transaction).
 */
function itemStatements(d1: D1Database, items: ReceiptBody["items"], receiptId: number | null) {
  const receiptIdSql = receiptId == null ? "(select seq from sqlite_sequence where name = 'receipts')" : "?";
  return items.map((item) => {
    const stmt = d1.prepare(
      `insert into receipt_items
         (receipt_id, product_id, raw_text, pieces, amount, price_full_cents, discount_cents, price_paid_cents)
       values (${receiptIdSql}, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const values = [
      item.productId,
      item.rawText,
      item.pieces,
      item.amount,
      item.priceFullCents,
      item.discountCents,
      pricePaidCents(item.priceFullCents, item.discountCents),
    ];
    return receiptId == null ? stmt.bind(...values) : stmt.bind(receiptId, ...values);
  });
}

/**
 * Per-chain alias for every line that carries printed text: "BAN.CHIQ" at this store's chain → product.
 * On a new receipt each confirmation counts (+1); on an edit only a changed product resets the count.
 * An alias pointing to a different product is overwritten: the latest confirmed choice wins.
 */
function aliasStatements(d1: D1Database, storeId: number, items: ReceiptBody["items"], countConfirmation: boolean) {
  const today = todayRome();
  const seen = new Set<string>();
  return items.flatMap((item) => {
    const norm = item.rawText ? normalizeRawText(item.rawText) : "";
    if (!norm || seen.has(norm)) return [];
    seen.add(norm);
    return [
      d1
        .prepare(
          `insert into product_aliases (chain_id, raw_text_norm, product_id, confirmations, last_seen)
           select s.chain_id, ?1, ?2, 1, ?3 from stores s where s.id = ?4
           on conflict(chain_id, raw_text_norm) do update set
             confirmations = case when product_aliases.product_id = excluded.product_id
                                  then product_aliases.confirmations + ?5 else 1 end,
             product_id = excluded.product_id,
             last_seen = excluded.last_seen`,
        )
        .bind(norm, item.productId, today, storeId, countConfirmation ? 1 : 0),
    ];
  });
}

const photoKey = (id: number, type: ImageType) => `receipts/${id}.${IMAGE_TYPES[type]}`;

export const receiptRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { from, to, limit, beforeDate, beforeId } = parseQuery(c, receiptListQuery);
    const { results } = await c.env.DB.prepare(
      `${SUMMARY_SELECT}
        where (?1 is null or r.date >= ?1) and (?2 is null or r.date <= ?2)
          and (?4 is null or r.date < ?4 or (r.date = ?4 and r.id < ?5))
        group by r.id
        order by r.date desc, r.id desc
        limit ?3`,
    )
      .bind(from ?? null, to ?? null, limit, beforeDate ?? null, beforeId ?? null)
      .all<ReceiptSummary & { notes: string | null; photoKey: string | null }>();
    return c.json(results.map(({ notes: _notes, photoKey: _photo, ...summary }) => summary satisfies ReceiptSummary));
  })
  .get("/:id", async (c) => {
    const id = parseId(c);
    const receipt = await c.env.DB.prepare(`${SUMMARY_SELECT} where r.id = ? group by r.id`)
      .bind(id)
      .first<ReceiptSummary & { notes: string | null; photoKey: string | null }>();
    if (!receipt) throw notFound("Scontrino non trovato");
    const { results: items } = await c.env.DB.prepare(
      `select ri.id, ri.product_id as productId, p.name as productName, p.brand as productBrand, p.unit,
              p.package_amount as packageAmount, p.avg_piece_amount as avgPieceAmount,
              ri.raw_text as rawText, ri.pieces, ri.amount, ri.price_full_cents as priceFullCents,
              ri.discount_cents as discountCents, ri.price_paid_cents as pricePaidCents
         from receipt_items ri
         join products p on p.id = ri.product_id
        where ri.receipt_id = ?
        order by ri.id`,
    )
      .bind(id)
      .all<ReceiptItem>();
    const { itemCount: _count, photoKey: key, ...rest } = receipt;
    const body: ReceiptDetail = { ...rest, hasPhoto: key != null, items };
    return c.json(body);
  })
  .post("/", async (c) => {
    const input = await parseBody(c, receiptInput);
    const d1 = c.env.DB;
    const [created] = await d1.batch<{ id: number }>([
      d1
        .prepare("insert into receipts (store_id, date, total_printed_cents, notes, source) values (?, ?, ?, ?, ?) returning id")
        .bind(input.storeId, input.date, input.totalPrintedCents, input.notes, input.source),
      ...itemStatements(d1, input.items, null),
      ...aliasStatements(d1, input.storeId, input.items, true),
    ]);
    return c.json<Created>({ id: created!.results[0]!.id }, 201);
  })
  .put("/:id", async (c) => {
    // Replaces header and all lines atomically.
    const id = parseId(c);
    const input = await parseBody(c, receiptInput);
    const d1 = c.env.DB;
    const exists = await d1.prepare("select 1 from receipts where id = ?").bind(id).first();
    if (!exists) throw notFound("Scontrino non trovato");
    await d1.batch([
      d1
        .prepare("update receipts set store_id = ?, date = ?, total_printed_cents = ?, notes = ? where id = ?")
        .bind(input.storeId, input.date, input.totalPrintedCents, input.notes, id),
      d1.prepare("delete from receipt_items where receipt_id = ?").bind(id),
      ...itemStatements(d1, input.items, id),
      ...aliasStatements(d1, input.storeId, input.items, false),
    ]);
    return c.json<Created>({ id });
  })
  .delete("/:id", async (c) => {
    const id = parseId(c);
    const row = await c.env.DB.prepare("delete from receipts where id = ? returning photo_key as photoKey")
      .bind(id)
      .first<{ photoKey: string | null }>();
    if (!row) throw notFound("Scontrino non trovato");
    if (row.photoKey) await c.env.RECEIPT_PHOTOS.delete(row.photoKey);
    return c.body(null, 204);
  })
  /** Stores the (client-compressed) photo of a saved receipt in the private bucket; replaces any previous one. */
  .put("/:id/photo", async (c) => {
    const id = parseId(c);
    const image = await parseImage(c);
    const existing = await c.env.DB.prepare("select photo_key as photoKey from receipts where id = ?")
      .bind(id)
      .first<{ photoKey: string | null }>();
    if (!existing) throw notFound("Scontrino non trovato");
    const key = photoKey(id, image.mimeType);
    await c.env.RECEIPT_PHOTOS.put(key, image.data, { httpMetadata: { contentType: image.mimeType } });
    await c.env.DB.prepare("update receipts set photo_key = ? where id = ?").bind(key, id).run();
    if (existing.photoKey && existing.photoKey !== key) await c.env.RECEIPT_PHOTOS.delete(existing.photoKey);
    return c.body(null, 204);
  })
  .get("/:id/photo", async (c) => {
    const id = parseId(c);
    const row = await c.env.DB.prepare("select photo_key as photoKey from receipts where id = ?")
      .bind(id)
      .first<{ photoKey: string | null }>();
    if (!row?.photoKey) throw notFound("Foto non trovata");
    const object = await c.env.RECEIPT_PHOTOS.get(row.photoKey);
    if (!object) throw notFound("Foto non trovata");
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        // Personal data: never in shared caches.
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
