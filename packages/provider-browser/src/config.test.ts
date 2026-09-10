import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { debugCaptureDir, debugCaptureEnabled, defaultProfileDir, headedByDefault } from "./config.ts";

const FALLBACK_PROFILE = join(homedir(), ".adam-mcp", "chrome-profile");

const previous = {
  headed: process.env.ADAM_BROWSER_HEADED,
  profile: process.env.ADAM_BROWSER_PROFILE_DIR,
  capture: process.env.ADAM_DEBUG_CAPTURE,
  captureDir: process.env.ADAM_DEBUG_CAPTURE_DIR,
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
  if (previous.capture === undefined) {
    delete process.env.ADAM_DEBUG_CAPTURE;
  } else {
    process.env.ADAM_DEBUG_CAPTURE = previous.capture;
  }
  if (previous.captureDir === undefined) {
    delete process.env.ADAM_DEBUG_CAPTURE_DIR;
  } else {
    process.env.ADAM_DEBUG_CAPTURE_DIR = previous.captureDir;
  }
});

describe("browser environment bounds", () => {
  it("defaults to the headless handoff and honors the headed debug override", () => {
    delete process.env.ADAM_BROWSER_HEADED;
    assert.equal(headedByDefault(), false);
    for (const value of ["1", "true", " YES "]) {
      process.env.ADAM_BROWSER_HEADED = value;
      assert.equal(headedByDefault(), true);
    }
    for (const value of ["0", "false", "no", ""]) {
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

  it("parses the debug capture switch and directory", () => {
    delete process.env.ADAM_DEBUG_CAPTURE;
    assert.equal(debugCaptureEnabled(), false);
    for (const value of ["0", "false", "no", ""]) {
      process.env.ADAM_DEBUG_CAPTURE = value;
      assert.equal(debugCaptureEnabled(), false);
    }
    for (const value of ["1", "true", " YES "]) {
      process.env.ADAM_DEBUG_CAPTURE = value;
      assert.equal(debugCaptureEnabled(), true);
    }
    process.env.ADAM_DEBUG_CAPTURE_DIR = " C:\\captures ";
    assert.equal(debugCaptureDir(), "C:\\captures");
    delete process.env.ADAM_DEBUG_CAPTURE_DIR;
    assert.match(debugCaptureDir(), /scratch$/);
  });
});
