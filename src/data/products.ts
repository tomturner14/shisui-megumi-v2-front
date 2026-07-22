import type { Product } from "@/types/product";

export const products: Product[] = [
  {
    handle: "shisui-koshihikari-5kg",
    title: "酒々井産コシヒカリ 5kg",
    description: "酒々井町で育てられたコシヒカリです。",
    imageUrl: null,
    priceYen: 3500,
    availableForSale: true,
  },
  {
    handle: "shisui-koshihikari-10kg",
    title: "酒々井産コシヒカリ 10kg",
    description: "酒々井町で育てられたコシヒカリを10kgでお届けします。",
    imageUrl: null,
    priceYen: 6500,
    availableForSale: false,
  },
];
