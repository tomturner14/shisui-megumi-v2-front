"use client";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CART_KEY, readCart, addItem, setQuantity } from "@/lib/cart";
import type { CartItem } from "@/types/catalog";
const EMPTY: CartItem[] = [];
let cachedRaw: string | null = null,
  cached: CartItem[] = EMPTY;
function snapshot() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CART_KEY);
  } catch {}
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cached = readCart(JSON.parse(raw ?? "[]"));
    } catch {
      cached = EMPTY;
    }
  }
  return cached;
}
function subscribe(fn: () => void) {
  window.addEventListener("storage", fn);
  window.addEventListener("shisui-cart", fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener("shisui-cart", fn);
  };
}
const Context = createContext<{
  items: CartItem[];
  ready: boolean;
  add: (i: CartItem) => void;
  quantity: (id: string, n: number) => void;
  clear: () => void;
  message: string;
  dismiss: () => void;
} | null>(null);
export function CartProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [message, setMessage] = useState("");
  function write(next: CartItem[]) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("shisui-cart"));
      setMessage("");
    } catch {
      setMessage(
        "カートを保存できません。ブラウザの保存設定を確認してください。",
      );
    }
  }
  return (
    <Context.Provider
      value={{
        items,
        ready,
        message,
        dismiss: () => setMessage(""),
        add: (item) => {
          try {
            write(addItem(snapshot(), item));
          } catch (e) {
            setMessage((e as Error).message);
          }
        },
        quantity: (id, n) => {
          try {
            write(setQuantity(snapshot(), id, n));
          } catch (e) {
            setMessage((e as Error).message);
          }
        },
        clear: () => write([]),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCart() {
  const value = useContext(Context);
  if (!value) throw new Error("CartProvider required");
  return value;
}
