import "server-only";
export function adminSettings(): Record<string, string | undefined> {
  return {
    ACCESS_ISSUER: process.env.ACCESS_ISSUER,
    ACCESS_AUD: process.env.ACCESS_AUD,
    ADMIN_SUBJECTS: process.env.ADMIN_SUBJECTS,
    ADMIN_ORIGIN: process.env.ADMIN_ORIGIN,
  };
}
