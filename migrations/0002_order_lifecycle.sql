-- Preserve legacy rows; never derive a deadline from an old creation time.
-- D1 enforces foreign_keys=ON; defer only inside this migration transaction.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE _lifecycle_migration_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO _lifecycle_migration_guard SELECT CASE WHEN
 NOT EXISTS (SELECT 1 FROM inventory i WHERE i.reserved !=
  (SELECT COALESCE(SUM(r.quantity),0) FROM inventory_reservations r WHERE r.sku_id=i.sku_id AND r.status='HELD'))
 AND NOT EXISTS (SELECT 1 FROM order_items i LEFT JOIN inventory_reservations r
  ON r.order_id=i.order_id AND r.sku_id=i.sku_id WHERE r.sku_id IS NULL OR r.quantity!=i.quantity)
 AND NOT EXISTS (SELECT 1 FROM orders o JOIN inventory_reservations r ON r.order_id=o.id WHERE
  (o.status IN ('REQUESTED','ACCEPTED') AND r.status!='HELD') OR
  (o.status='CANCELLED' AND r.status!='RELEASED') OR (o.status='COMPLETED' AND r.status!='CONSUMED'))
 THEN 1 ELSE 0 END;
DROP TABLE _lifecycle_migration_guard;
DROP TRIGGER validate_order_item;
CREATE TABLE orders_next (
 id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 seller_id TEXT NOT NULL REFERENCES sellers(id),
 status TEXT NOT NULL CHECK(status IN ('REQUESTED','ACCEPTED','CANCELLED','COMPLETED','REJECTED','EXPIRED')),
 fulfillment TEXT NOT NULL CHECK(fulfillment = 'PICKUP'),
 payment_method TEXT NOT NULL CHECK(payment_method = 'CASH'),
 buyer_name TEXT NOT NULL CHECK(length(buyer_name) BETWEEN 1 AND 80),
 buyer_contact TEXT NOT NULL CHECK(length(buyer_contact) BETWEEN 3 AND 120),
 pickup_conditions TEXT NOT NULL,
 expected_total_yen INTEGER NOT NULL CHECK(expected_total_yen > 0),
 total_yen INTEGER NOT NULL DEFAULT 0 CHECK(total_yen >= 0),
 currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency = 'JPY'),
 requested_at_ms INTEGER CHECK(requested_at_ms >= 0),
 expires_at_ms INTEGER CHECK(expires_at_ms >= 0),
 last_event_id TEXT,
 status_changed_at_ms INTEGER CHECK(status_changed_at_ms >= 0),
 handover_recorded_at_ms INTEGER CHECK(handover_recorded_at_ms >= 0),
 cash_received_at_ms INTEGER CHECK(cash_received_at_ms >= 0),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((requested_at_ms IS NULL AND expires_at_ms IS NULL) OR (requested_at_ms IS NOT NULL AND expires_at_ms IS NOT NULL AND expires_at_ms > requested_at_ms))
) STRICT;
INSERT INTO orders_next(id,idempotency_key,request_hash,seller_id,status,fulfillment,payment_method,buyer_name,buyer_contact,pickup_conditions,expected_total_yen,total_yen,currency,created_at) SELECT id,idempotency_key,request_hash,seller_id,status,fulfillment,payment_method,buyer_name,buyer_contact,pickup_conditions,expected_total_yen,total_yen,currency,created_at FROM orders;
DROP TABLE orders;
ALTER TABLE orders_next RENAME TO orders;
CREATE INDEX orders_seller_status ON orders(seller_id,status);

ALTER TABLE inventory_reservations ADD COLUMN released_at_ms INTEGER CHECK(released_at_ms >= 0);
CREATE INDEX reservations_sku_status ON inventory_reservations(sku_id,status);
CREATE INDEX orders_expiry ON orders(expires_at_ms,id) WHERE status='REQUESTED' AND expires_at_ms IS NOT NULL;
CREATE TRIGGER validate_order_item BEFORE INSERT ON order_items BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM skus s JOIN products p ON p.id=s.product_id
  JOIN sellers v ON v.id=p.seller_id JOIN orders o ON o.id=NEW.order_id
  WHERE s.id=NEW.sku_id AND p.seller_id=o.seller_id AND s.active=1 AND p.active=1 AND v.active=1 AND o.status='REQUESTED' AND o.total_yen=0
  AND s.price_yen=NEW.unit_price_yen AND p.title=NEW.product_name AND s.label=NEW.sku_label
 ) THEN RAISE(ABORT, 'INVALID_ORDER_ITEM') END;
END;
CREATE TRIGGER validate_order_total BEFORE UPDATE OF total_yen ON orders BEGIN
 SELECT CASE WHEN NEW.total_yen != NEW.expected_total_yen OR NEW.total_yen != (
  SELECT COALESCE(SUM(subtotal_yen),0) FROM order_items WHERE order_id=NEW.id
 ) THEN RAISE(ABORT, 'PRICE_CHANGED') END;
END;
DROP TRIGGER validate_reservation;
CREATE TRIGGER validate_reservation BEFORE INSERT ON inventory_reservations BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM inventory WHERE sku_id=NEW.sku_id AND on_hand-reserved >= NEW.quantity
 ) THEN RAISE(ABORT, 'OUT_OF_STOCK') END;
 SELECT CASE WHEN NEW.status!='HELD' OR NEW.released_at_ms IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM orders WHERE id=NEW.order_id AND status='REQUESTED' AND total_yen=0
 ) THEN RAISE(ABORT, 'INVALID_RESERVATION_STATE') END;
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM order_items WHERE order_id=NEW.order_id AND sku_id=NEW.sku_id AND quantity=NEW.quantity
 ) THEN RAISE(ABORT, 'INVALID_RESERVATION') END;
END;

CREATE TABLE order_events (
 id TEXT PRIMARY KEY, operation_key TEXT NOT NULL UNIQUE,
 order_id TEXT NOT NULL REFERENCES orders(id),
 operation TEXT NOT NULL CHECK(operation IN ('ACCEPT','REJECT','CANCEL','EXPIRE')),
 actor_category TEXT NOT NULL CHECK(actor_category IN ('OPERATOR','SYSTEM')),
 from_status TEXT NOT NULL CHECK(from_status IN ('REQUESTED','ACCEPTED')),
 to_status TEXT NOT NULL CHECK(to_status IN ('ACCEPTED','REJECTED','CANCELLED','EXPIRED')),
 occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms >= 0),
 CHECK((operation='ACCEPT' AND to_status='ACCEPTED') OR
       (operation='REJECT' AND to_status='REJECTED') OR
       (operation='CANCEL' AND to_status='CANCELLED') OR
       (operation='EXPIRE' AND to_status='EXPIRED')),
 CHECK((operation='EXPIRE' AND actor_category='SYSTEM') OR
       (operation!='EXPIRE' AND actor_category='OPERATOR'))
) STRICT;
CREATE INDEX order_events_order ON order_events(order_id,occurred_at_ms);

CREATE TRIGGER validate_new_order BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN NEW.status!='REQUESTED' OR NEW.requested_at_ms IS NULL OR NEW.expires_at_ms IS NULL
  OR NEW.last_event_id IS NOT NULL OR NEW.status_changed_at_ms IS NOT NULL
  OR NEW.handover_recorded_at_ms IS NOT NULL OR NEW.cash_received_at_ms IS NOT NULL
  THEN RAISE(ABORT,'INVALID_NEW_ORDER') END;
END;
CREATE TRIGGER immutable_order_deadline BEFORE UPDATE OF requested_at_ms,expires_at_ms ON orders
 WHEN NEW.requested_at_ms IS NOT OLD.requested_at_ms OR NEW.expires_at_ms IS NOT OLD.expires_at_ms BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_DEADLINE');
END;
CREATE TRIGGER validate_fulfillment_markers BEFORE UPDATE OF handover_recorded_at_ms,cash_received_at_ms ON orders BEGIN
 SELECT CASE WHEN NEW.status NOT IN ('ACCEPTED','COMPLETED')
  OR (OLD.handover_recorded_at_ms IS NOT NULL AND NEW.handover_recorded_at_ms IS NOT OLD.handover_recorded_at_ms)
  OR (OLD.cash_received_at_ms IS NOT NULL AND NEW.cash_received_at_ms IS NOT OLD.cash_received_at_ms)
 THEN RAISE(ABORT,'INVALID_FULFILLMENT_MARKER') END;
END;
CREATE TRIGGER validate_order_event BEFORE INSERT ON order_events BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id)
  THEN RAISE(ABORT,'ORDER_NOT_FOUND') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND status=NEW.from_status AND
  ((status='REQUESTED' AND NEW.to_status IN ('ACCEPTED','REJECTED','CANCELLED','EXPIRED')) OR
   (status='ACCEPTED' AND NEW.to_status='CANCELLED')))
  THEN RAISE(ABORT,'TRANSITION_NOT_ALLOWED') END;
 SELECT CASE WHEN NEW.to_status='ACCEPTED' AND (SELECT expires_at_ms FROM orders WHERE id=NEW.order_id) IS NULL
  THEN RAISE(ABORT,'DEADLINE_REQUIRED') END;
 SELECT CASE WHEN NEW.to_status='ACCEPTED' AND NEW.occurred_at_ms >= (SELECT expires_at_ms FROM orders WHERE id=NEW.order_id)
  THEN RAISE(ABORT,'DEADLINE_PASSED') END;
 SELECT CASE WHEN NEW.to_status='EXPIRED' AND NOT EXISTS
  (SELECT 1 FROM orders WHERE id=NEW.order_id AND expires_at_ms IS NOT NULL AND expires_at_ms <= NEW.occurred_at_ms)
  THEN RAISE(ABORT,'NOT_DUE') END;
 SELECT CASE WHEN NEW.to_status='CANCELLED' AND EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND
  (handover_recorded_at_ms IS NOT NULL OR cash_received_at_ms IS NOT NULL))
  THEN RAISE(ABORT,'CANCELLATION_BLOCKED') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND
  (requested_at_ms > NEW.occurred_at_ms OR status_changed_at_ms > NEW.occurred_at_ms))
  THEN RAISE(ABORT,'INVALID_EVENT_TIME') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM order_items WHERE order_id=NEW.order_id)
  OR EXISTS (SELECT 1 FROM order_items i LEFT JOIN inventory_reservations r
    ON r.order_id=i.order_id AND r.sku_id=i.sku_id WHERE i.order_id=NEW.order_id AND
    (r.sku_id IS NULL OR r.quantity!=i.quantity OR r.status!='HELD'))
  THEN RAISE(ABORT,'RESERVATION_MISMATCH') END;
END;
-- Only an inserted, validated event can drive an order status change.
CREATE TRIGGER guard_order_transition BEFORE UPDATE OF status,last_event_id,status_changed_at_ms ON orders
 WHEN NEW.status IS NOT OLD.status OR NEW.last_event_id IS NOT OLD.last_event_id OR NEW.status_changed_at_ms IS NOT OLD.status_changed_at_ms BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM order_events e WHERE e.id=NEW.last_event_id AND e.order_id=OLD.id
  AND e.from_status=OLD.status AND e.to_status=NEW.status AND e.occurred_at_ms=NEW.status_changed_at_ms)
  THEN RAISE(ABORT,'AUDITED_TRANSITION_REQUIRED') END;
END;
CREATE TRIGGER validate_reservation_change BEFORE UPDATE ON inventory_reservations
 WHEN NEW.status IS NOT OLD.status OR NEW.quantity!=OLD.quantity OR NEW.order_id!=OLD.order_id
 OR NEW.sku_id!=OLD.sku_id OR NEW.released_at_ms IS NOT OLD.released_at_ms BEGIN
 SELECT CASE WHEN OLD.status!='HELD' OR NEW.status!='RELEASED' OR NEW.quantity!=OLD.quantity
  OR NEW.order_id!=OLD.order_id OR NEW.sku_id!=OLD.sku_id OR NOT EXISTS
  (SELECT 1 FROM orders o JOIN order_events e ON e.id=o.last_event_id WHERE o.id=OLD.order_id
   AND o.status IN ('REJECTED','CANCELLED','EXPIRED') AND e.occurred_at_ms=NEW.released_at_ms)
  THEN RAISE(ABORT,'INVALID_RESERVATION_STATE') END;
END;
CREATE TRIGGER release_inventory AFTER UPDATE OF status ON inventory_reservations
 WHEN OLD.status='HELD' AND NEW.status='RELEASED' BEGIN
 UPDATE inventory SET reserved=reserved-OLD.quantity WHERE sku_id=OLD.sku_id;
END;
CREATE TRIGGER inventory_initial_reserved_matches_holds BEFORE INSERT ON inventory
 WHEN NOT EXISTS (SELECT 1 FROM inventory WHERE sku_id=NEW.sku_id) BEGIN
 SELECT CASE WHEN NEW.reserved != (SELECT COALESCE(SUM(quantity),0) FROM inventory_reservations
  WHERE sku_id=NEW.sku_id AND status='HELD') THEN RAISE(ABORT,'INVENTORY_HOLD_MISMATCH') END;
END;
CREATE TRIGGER inventory_reserved_matches_holds BEFORE UPDATE OF reserved ON inventory BEGIN
 SELECT CASE WHEN NEW.reserved != (SELECT COALESCE(SUM(quantity),0) FROM inventory_reservations
  WHERE sku_id=NEW.sku_id AND status='HELD') THEN RAISE(ABORT,'INVENTORY_HOLD_MISMATCH') END;
END;
CREATE TRIGGER immutable_reservation_delete BEFORE DELETE ON inventory_reservations BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_RESERVATION');
END;
CREATE TRIGGER immutable_order_item_update BEFORE UPDATE ON order_items BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_ORDER_ITEM');
END;
CREATE TRIGGER immutable_order_item_delete BEFORE DELETE ON order_items BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_ORDER_ITEM');
END;
CREATE TRIGGER immutable_order_event_update BEFORE UPDATE ON order_events BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_ORDER_EVENT');
END;
CREATE TRIGGER immutable_order_event_delete BEFORE DELETE ON order_events BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_ORDER_EVENT');
END;
CREATE TRIGGER apply_order_event AFTER INSERT ON order_events BEGIN
 UPDATE orders SET status=NEW.to_status,last_event_id=NEW.id,status_changed_at_ms=NEW.occurred_at_ms
 WHERE id=NEW.order_id AND status=NEW.from_status;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND status=NEW.to_status AND last_event_id=NEW.id)
  THEN RAISE(ABORT,'TRANSITION_NOT_APPLIED') END;
 UPDATE inventory_reservations SET status='RELEASED',released_at_ms=NEW.occurred_at_ms
 WHERE order_id=NEW.order_id AND status='HELD' AND NEW.to_status IN ('REJECTED','CANCELLED','EXPIRED');
 SELECT CASE WHEN EXISTS (SELECT 1 FROM inventory_reservations WHERE order_id=NEW.order_id AND
  status != CASE WHEN NEW.to_status='ACCEPTED' THEN 'HELD' ELSE 'RELEASED' END)
  THEN RAISE(ABORT,'RESERVATION_MISMATCH') END;
END;
PRAGMA defer_foreign_keys = OFF;
