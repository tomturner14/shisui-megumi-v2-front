PRAGMA foreign_keys = ON;
CREATE TABLE sellers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, pickup_conditions TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE TABLE products (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES sellers(id),
 handle TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
 image_url TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE INDEX products_seller ON products(seller_id);
CREATE TABLE skus (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), label TEXT NOT NULL,
 price_yen INTEGER NOT NULL CHECK(price_yen > 0 AND price_yen <= 1000000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE INDEX skus_product ON skus(product_id);
CREATE TABLE inventory (
 sku_id TEXT PRIMARY KEY REFERENCES skus(id),
 on_hand INTEGER NOT NULL CHECK(on_hand >= 0),
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= on_hand)
) STRICT;
CREATE TABLE orders (
 id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 seller_id TEXT NOT NULL REFERENCES sellers(id),
 status TEXT NOT NULL CHECK(status IN ('REQUESTED','ACCEPTED','CANCELLED','COMPLETED')),
 fulfillment TEXT NOT NULL CHECK(fulfillment = 'PICKUP'),
 payment_method TEXT NOT NULL CHECK(payment_method = 'CASH'),
 buyer_name TEXT NOT NULL CHECK(length(buyer_name) BETWEEN 1 AND 80),
 buyer_contact TEXT NOT NULL CHECK(length(buyer_contact) BETWEEN 3 AND 120),
 pickup_conditions TEXT NOT NULL,
 expected_total_yen INTEGER NOT NULL CHECK(expected_total_yen > 0),
 total_yen INTEGER NOT NULL DEFAULT 0 CHECK(total_yen >= 0),
 currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency = 'JPY'),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX orders_seller_status ON orders(seller_id, status);
CREATE TABLE order_items (
 order_id TEXT NOT NULL REFERENCES orders(id), sku_id TEXT NOT NULL REFERENCES skus(id),
 product_name TEXT NOT NULL, sku_label TEXT NOT NULL,
 unit_price_yen INTEGER NOT NULL CHECK(unit_price_yen > 0),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 subtotal_yen INTEGER GENERATED ALWAYS AS (unit_price_yen * quantity) STORED,
 PRIMARY KEY(order_id, sku_id)
) STRICT;
CREATE TABLE inventory_reservations (
 order_id TEXT NOT NULL, sku_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 status TEXT NOT NULL DEFAULT 'HELD' CHECK(status IN ('HELD','RELEASED','CONSUMED')),
 PRIMARY KEY(order_id, sku_id),
 FOREIGN KEY(order_id, sku_id) REFERENCES order_items(order_id, sku_id)
) STRICT;
-- Reject missing SKU, stopped sale, cross-seller lines, and stale snapshots inside batch.
CREATE TRIGGER validate_order_item BEFORE INSERT ON order_items BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM skus s JOIN products p ON p.id=s.product_id
  JOIN sellers v ON v.id=p.seller_id JOIN orders o ON o.id=NEW.order_id
  WHERE s.id=NEW.sku_id AND p.seller_id=o.seller_id AND s.active=1 AND p.active=1 AND v.active=1
  AND s.price_yen=NEW.unit_price_yen AND p.title=NEW.product_name AND s.label=NEW.sku_label
 ) THEN RAISE(ABORT, 'INVALID_ORDER_ITEM') END;
END;
CREATE TRIGGER reserve_order_item AFTER INSERT ON order_items BEGIN
 INSERT INTO inventory_reservations(order_id,sku_id,quantity)
 VALUES(NEW.order_id,NEW.sku_id,NEW.quantity);
END;
-- A conditional UPDATE with zero changes is NOT an error. Raise explicitly first.
CREATE TRIGGER validate_reservation BEFORE INSERT ON inventory_reservations BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM inventory WHERE sku_id=NEW.sku_id AND on_hand-reserved >= NEW.quantity
 ) THEN RAISE(ABORT, 'OUT_OF_STOCK') END;
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM order_items WHERE order_id=NEW.order_id AND sku_id=NEW.sku_id AND quantity=NEW.quantity
 ) THEN RAISE(ABORT, 'INVALID_RESERVATION') END;
END;
CREATE TRIGGER hold_inventory AFTER INSERT ON inventory_reservations BEGIN
 UPDATE inventory SET reserved=reserved+NEW.quantity WHERE sku_id=NEW.sku_id;
END;
CREATE TRIGGER validate_order_total BEFORE UPDATE OF total_yen ON orders BEGIN
 SELECT CASE WHEN NEW.total_yen != NEW.expected_total_yen OR NEW.total_yen != (
  SELECT COALESCE(SUM(subtotal_yen),0) FROM order_items WHERE order_id=NEW.id
 ) THEN RAISE(ABORT, 'PRICE_CHANGED') END;
END;
