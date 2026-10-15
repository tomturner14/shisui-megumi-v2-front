"use client";
import Link from "next/link";
import { useCart } from "./CartProvider";
export function CartLink() {
  const { items } = useCart();
  return (
    <Link href="/cart">カート {items.reduce((n, i) => n + i.quantity, 0)}</Link>
  );
}
