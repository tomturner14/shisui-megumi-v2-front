import "server-only";
// UTC epoch milliseconds. Default is a local verification policy, not a live business decision.
export function orderDeadline(
  nowMs: number,
  ttlMinutes: unknown = process.env.ORDER_REQUEST_TTL_MINUTES,
): number {
  const minutes = ttlMinutes === undefined ? 1440 : Number(ttlMinutes);
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 10080
  )
    throw new Error("Invalid order deadline policy");
  const expires = nowMs + minutes * 60000;
  if (!Number.isSafeInteger(expires)) throw new Error("Invalid order deadline");
  return expires;
}
