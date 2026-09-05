import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createSoapProvider } from "./index.ts";

describe("SoapAdamProvider", () => {
  it("fails closed until ADAM SOAP is approved", async () => {
    const provider = createSoapProvider();
    await assert.rejects(() => provider.listCourses(), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "provider_unavailable");
      return true;
    });
    await assert.rejects(() => provider.extractFileText("1"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "provider_unavailable");
      return true;
    });
    await assert.rejects(() => provider.getExercise("1"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "provider_unavailable");
      return true;
    });
  });
});
