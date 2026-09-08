import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cookie } from "playwright-core";
import { injectableCookies } from "./session-handoff.ts";

describe("injectableCookies", () => {
  it("keeps session cookies as expires -1 and does not invent a disk path", () => {
    const input: Cookie[] = [
      {
        name: "PHPSESSID",
        value: "secret-session",
        domain: "adam.unibas.ch",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
      {
        name: "remember",
        value: "other",
        domain: ".eduid.ch",
        path: "/",
        expires: 2_000_000_000,
        httpOnly: false,
        secure: true,
        sameSite: "None",
      },
    ];
    const out = injectableCookies(input);
    assert.equal(out[0]?.expires, -1);
    assert.equal(out[1]?.expires, 2_000_000_000);
    assert.equal(out[1]?.sameSite, "None");
    assert.equal(out.length, 2);
  });

  it("falls back to Lax when sameSite is missing", () => {
    const out = injectableCookies([
      {
        name: "x",
        value: "y",
        domain: "adam.unibas.ch",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    assert.equal(out[0]?.sameSite, "Lax");
  });
});
