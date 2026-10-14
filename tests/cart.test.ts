import { test } from "node:test";
import assert from "node:assert/strict";
import { addItem, setQuantity, readCart } from "../src/lib/cart";
const a = { skuId: "carrot-500", sellerId: "seller-a", quantity: 2 };
test("same seller / multiple SKU / duplicate quantities / decrement / delete", () => {
  let cart = addItem([], a);
  cart = addItem(cart, a);
  assert.equal(cart[0].quantity, 4);
  cart = addItem(cart, { ...a, skuId: "rice-2kg" });
  assert.equal(cart.length, 2);
  cart = setQuantity(cart, a.skuId, 3);
  assert.equal(cart[0].quantity, 3);
  cart = setQuantity(cart, a.skuId, 0);
  assert.equal(cart[0].skuId, "rice-2kg");
});
test("mixed sellers leave existing cart intact", () => {
  const cart = [a];
  assert.throws(() =>
    addItem(cart, { skuId: "potato-1kg", sellerId: "seller-b", quantity: 1 }),
  );
  assert.deepEqual(cart, [a]);
});
test("stored cart strips all extra fields and rejects malformed or mixed entries", () => {
  assert.deepEqual(readCart([{ ...a, name: "never persist", price: 1 }]), [a]);
  for (const v of [
    [{ ...a, quantity: 0 }],
    [{ ...a, quantity: 1.1 }],
    [a, a],
    [a, { ...a, skuId: "rice-2kg", sellerId: "seller-b" }],
  ])
    assert.deepEqual(readCart(v), []);
  assert.throws(() => setQuantity([a], a.skuId, 100));
});
