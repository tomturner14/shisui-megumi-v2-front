import type { Product } from "@/types/product";

function isHttpsUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

export function isProduct(value: unknown): value is Product {
  if (typeof value !== "object" || value === null) return false;

  if (!("handle" in value) || typeof value.handle !== "string") {
    return false;
  }

  if (!("title" in value) || typeof value.title !== "string") {
    return false;
  }

  if (!("description" in value) || typeof value.description !== "string") {
    return false;
  }

  if (
    !("imageUrl" in value) ||
    (typeof value.imageUrl !== "string" && value.imageUrl !== null) ||
    (typeof value.imageUrl === "string" && !isHttpsUrl(value.imageUrl))
  ) {
    return false;
  }

  if (
    !("priceYen" in value) ||
    typeof value.priceYen !== "number" ||
    !Number.isSafeInteger(value.priceYen) ||
    value.priceYen < 0
  ) {
    return false;
  }

  if (
    !("availableForSale" in value) ||
    typeof value.availableForSale !== "boolean"
  ) {
    return false;
  }

  return true;
}

export function isProductArray(value: unknown): value is Product[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((item) => isProduct(item));
}
