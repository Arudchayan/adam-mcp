import type { Cookie } from "playwright-core";

/** Map a live Chrome cookie jar for addCookies. Never log the result. */
export function injectableCookies(cookies: readonly Cookie[]): Cookie[] {
  return cookies.map((cookie) => {
    const sameSite =
      cookie.sameSite === "Strict" || cookie.sameSite === "Lax" || cookie.sameSite === "None"
        ? cookie.sameSite
        : "Lax";
    const next: Cookie = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires > 0 ? cookie.expires : -1,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite,
    };
    if (cookie.partitionKey) {
      next.partitionKey = cookie.partitionKey;
    }
    return next;
  });
}
