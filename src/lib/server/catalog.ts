import "server-only";
import { getDB } from "@/lib/server/db";
import type { CatalogProduct } from "@/types/catalog";
type Row = {
  id: string;
  seller_id: string;
  seller_name: string;
  pickup_conditions: string;
  handle: string;
  title: string;
  description: string;
  image_url: string | null;
  sku_id: string;
  label: string;
  price_yen: number;
  available: number;
  active: number;
};
export async function getProducts(handle?: string): Promise<CatalogProduct[]> {
  const db = await getDB();
  const rows = await db
    .prepare(
      `SELECT p.id,p.seller_id,v.name seller_name,v.pickup_conditions,
 p.handle,p.title,p.description,p.image_url,s.id sku_id,s.label,s.price_yen,
 i.on_hand-i.reserved available,s.active FROM products p
 JOIN sellers v ON v.id=p.seller_id JOIN skus s ON s.product_id=p.id JOIN inventory i ON i.sku_id=s.id
 WHERE p.active=1 AND v.active=1 ${handle === undefined ? "" : "AND p.handle=?"} ORDER BY p.id,s.price_yen`,
    )
    .bind(...(handle === undefined ? [] : [handle]))
    .all<Row>();
  const products = new Map<string, CatalogProduct>();
  for (const r of rows.results) {
    if (!products.has(r.id))
      products.set(r.id, {
        id: r.id,
        sellerId: r.seller_id,
        sellerName: r.seller_name,
        pickupConditions: r.pickup_conditions,
        handle: r.handle,
        title: r.title,
        description: r.description,
        imageUrl: r.image_url,
        skus: [],
      });
    products
      .get(r.id)!
      .skus.push({
        id: r.sku_id,
        label: r.label,
        priceYen: r.price_yen,
        available: r.available,
        active: r.active === 1,
      });
  }
  return [...products.values()];
}
