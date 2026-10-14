import { connection } from "next/server";
import { getProducts } from "@/lib/server/catalog";
import { CartCheckout } from "@/components/CartCheckout";
export default async function CartPage() {
  await connection();
  return <CartCheckout products={await getProducts()} />;
}
