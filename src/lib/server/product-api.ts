import "server-only";

import { fetchFromExpress } from "@/lib/server/express-api";
import { isProductArray, isProduct } from "@/lib/validators/product";
import type { Product } from "@/types/product";

export async function fetchProducts(): Promise<Product[]> {
  const result = await fetchFromExpress("/api/products");

  if (!result.ok) {
    throw new Error("Express APIから商品一覧を取得できませんでした。");
  }

  if (!isProductArray(result.body)) {
    throw new Error(
      "Express APIから受け取った商品一覧が契約に違反しています。",
    );
  }

  return result.body;
}

export async function fetchProduct(handle: string): Promise<Product | null> {
  const result = await fetchFromExpress(
    `/api/products/${encodeURIComponent(handle)}`,
  );

  if (!result.ok) {
    if (
      result.body.code === "NOT_FOUND" ||
      result.body.code === "INVALID_HANDLE"
    ) {
      return null;
    }

    throw new Error("Express APIから商品詳細を取得できませんでした。");
  }

  if (!isProduct(result.body)) {
    throw new Error(
      "Express APIから受け取った商品詳細が契約に違反しています。",
    );
  }

  return result.body;
}
