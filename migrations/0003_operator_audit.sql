-- Old events remain unchanged; NULL means that no verified subject was recorded.
ALTER TABLE order_events ADD COLUMN actor_id TEXT
 CHECK(actor_id IS NULL OR (actor_category='OPERATOR' AND length(actor_id) BETWEEN 1 AND 200));
CREATE INDEX order_events_actor ON order_events(actor_id,occurred_at_ms) WHERE actor_id IS NOT NULL;
CREATE INDEX orders_admin_created ON orders(created_at DESC,id DESC);
