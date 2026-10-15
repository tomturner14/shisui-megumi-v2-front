import { test as base, expect } from "@playwright/test";
import { localE2EBaseURL, localRequestURL } from "../e2e-safety";
export const test = base.extend({
  context: async ({ context, baseURL }, runFixture) => {
    const origin = localE2EBaseURL(baseURL);
    await context.route("**/*", async (route) => {
      try {
        localRequestURL(route.request().url(), origin);
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      await route.fallback();
    });
    await runFixture(context);
  },
  request: async ({ request, baseURL }, runFixture) => {
    const origin = localE2EBaseURL(baseURL);
    // Guard absolute request URLs too, and never follow HTTP redirects with POST bodies.
    const guarded = new Proxy(request, {
      get(target, property) {
        const method = Reflect.get(target, property);
        if (
          ["get", "post", "put", "patch", "delete", "head", "fetch"].includes(
            String(property),
          )
        )
          return (url: string, options?: object) => {
            if (typeof url !== "string")
              throw new Error("E2E requests require an explicit local URL.");
            return method.call(target, localRequestURL(url, origin), {
              ...options,
              maxRedirects: 0,
            });
          };
        return typeof method === "function" ? method.bind(target) : method;
      },
    });
    await runFixture(guarded);
  },
});
export { expect };
