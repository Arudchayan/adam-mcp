import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { defaultProfileDir, headedByDefault } from "./config.ts";

const FALLBACK_PROFILE = join(homedir(), ".adam-mcp", "chrome-profile");

const previous = {
  headed: process.env.ADAM_BROWSER_HEADED,
  profile: process.env.ADAM_BROWSER_PROFILE_DIR,
};

afterEach(() => {
  if (previous.headed === undefined) {
    delete process.env.ADAM_BROWSER_HEADED;
  } else {
    process.env.ADAM_BROWSER_HEADED = previous.headed;
  }
  if (previous.profile === undefined) {
    delete process.env.ADAM_BROWSER_PROFILE_DIR;
  } else {
    process.env.ADAM_BROWSER_PROFILE_DIR = previous.profile;
  }
});

describe("browser environment bounds", () => {
  it("defaults to headed and honors explicit negatives", () => {
    delete process.env.ADAM_BROWSER_HEADED;
    assert.equal(headedByDefault(), true);
    for (const value of ["1", "yes", "true"]) {
      process.env.ADAM_BROWSER_HEADED = value;
      assert.equal(headedByDefault(), true);
    }
    for (const value of ["0", "false", "no", " FALSE "]) {
      process.env.ADAM_BROWSER_HEADED = value;
      assert.equal(headedByDefault(), false);
    }
  });

  it("uses the configured profile dir and falls back on blank values", () => {
    process.env.ADAM_BROWSER_PROFILE_DIR = "C:\\adam-test-profile";
    assert.equal(defaultProfileDir(), "C:\\adam-test-profile");
    process.env.ADAM_BROWSER_PROFILE_DIR = "  ";
    assert.equal(defaultProfileDir(), FALLBACK_PROFILE);
  });
});
