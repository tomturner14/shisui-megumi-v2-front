import {
  PENDING_KEY,
  parsePending,
  publicQuote,
  type PendingCheckout,
} from "./checkout";
export type PendingState = PendingCheckout | "blocked" | null;
let lastRaw: string | null | undefined = undefined,
  lastState: PendingState = null;
export function pendingSnapshot(): PendingState {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw !== lastRaw) {
      lastRaw = raw;
      lastState = raw === null ? null : parsePending(raw);
    }
    return lastState;
  } catch {
    lastRaw = undefined;
    lastState = "blocked";
    return lastState;
  }
}
export function subscribePending(fn: () => void) {
  window.addEventListener("shisui-pending", fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener("shisui-pending", fn);
    window.removeEventListener("storage", fn);
  };
}
export function savePending(pending: PendingCheckout) {
  const safe = { key: pending.key, quote: publicQuote(pending.quote) };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(safe));
  window.dispatchEvent(new Event("shisui-pending"));
}
export function clearPending() {
  sessionStorage.removeItem(PENDING_KEY);
  window.dispatchEvent(new Event("shisui-pending"));
}
