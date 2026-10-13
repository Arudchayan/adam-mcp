/** Blocking adversarial regression tests. All data is synthetic; no live login. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError, redactText, redactUrl } from "adam-core";
import {
  deepRedact,
  fail,
  formatAdamFailText,
  ok,
  resourceJsonText,
  runProvider,
  UntrustedContent,
} from "./results.ts";
describe("R-01 JSESSIONID", () => {
  it(
    "R-01 bare JSESSIONID= is redacted",
    () => {
      const marker = "R01BAREABC123DEF";
      const redacted = redactText(`JSESSIONID=${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );

  it(
    "R-01 cookie-jar jsessionid assignment without Cookie: prefix is redacted",
    () => {
      const marker = "R01JARABC456DEF";
      const redacted = redactText(`jsessionid=${marker}; Path=/; HttpOnly`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );

  it(
    "R-01 query ?JSESSIONID= via redactText is redacted",
    () => {
      const marker = "R01QUERYABC789DEF";
      const redacted = redactText(`https://adam.unibas.ch/go/crs/1?JSESSIONID=${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );
});
describe("R-02 otp/totp/recovery", () => {
  it(
    "R-02 otp= is redacted",
    () => {
      const marker = "482917";
      const redacted = redactText(`otp=${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );

  it(
    "R-02 totp= is redacted",
    () => {
      const marker = "739182";
      const redacted = redactText(`totp=${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );

  it(
    "R-02 recovery_code= is redacted",
    () => {
      const marker = "R02RECOVERYABC123";
      const redacted = redactText(`recovery_code=${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );
});
describe("R-03 eduid/aai", () => {
  it(
    "R-03 eduid is redacted",
    () => {
      const marker = "R03EDUIDABC123";
      const redacted = redactText(`eduid=${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );

  it(
    "R-03 aai is redacted",
    () => {
      const marker = "R03AAIXYZ789";
      const redacted = redactText(`aai=${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );
});
describe("R-04 Digest", () => {
  it(
    "R-04 Authorization: Digest is redacted",
    () => {
      const marker = "R04DIGESTABC123XYZ";
      const redacted = redactText(`Authorization: Digest username="student" response="${marker}"`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );
});
describe("R-05 secret-adjacent colon carrier", () => {
  it(
    "R-05 secret: hunter2 is redacted",
    () => {
      const marker = "R05COLONhunter2XYZ";
      const redacted = redactText(`secret: ${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );
});
describe("R-06 proxy/Negotiate", () => {
  it(
    "R-06 Proxy-Authenticate: Negotiate is redacted",
    () => {
      const marker = "R06PROXYSQUIDABC123";
      const redacted = redactText(`Proxy-Authenticate: Negotiate ${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );

  it(
    "R-06 Authorization: Negotiate is redacted",
    () => {
      const marker = "R06NEGOTIATEABC123";
      const redacted = redactText(`Authorization: Negotiate ${marker}`);
      assert.doesNotMatch(redacted, new RegExp(marker));
    },
  );
});
describe("U-01 redactUrl keeps ref_id", () => {
  it("U-01 token query is redacted but ref_id survives", () => {
    const redacted = redactUrl("https://adam.unibas.ch/go/crs/1?token=hunter2&ref_id=42");
    assert.doesNotMatch(redacted, /hunter2/);
    assert.match(redacted, /ref_id=42/);
  });

  it("U-01 password query is redacted but ref_id survives", () => {
    const redacted = redactUrl("https://adam.unibas.ch/go/crs/1?password=hunter2&ref_id=42");
    assert.doesNotMatch(redacted, /hunter2/);
    assert.match(redacted, /ref_id=42/);
  });

  it("U-01 secret/session query is redacted but ref_id survives", () => {
    const redacted = redactUrl("https://adam.unibas.ch/go/crs/1?secret=topsecret&session=abc&ref_id=42");
    assert.doesNotMatch(redacted, /topsecret/);
    assert.doesNotMatch(redacted, /session=abc/);
    assert.match(redacted, /ref_id=42/);
  });
});
describe("U-02 fragment/matrix fragment and matrix redaction", () => {
  it("U-02 fragment token is redacted", () => {
    const marker = "U02FRAGSECRETXYZ";
    const redacted = redactUrl(`https://adam.unibas.ch/go/crs/1?ref_id=5#token=${marker}`);
    assert.doesNotMatch(redacted, new RegExp(marker));
    assert.match(redacted, /ref_id=5/);
  });

  it("U-02 matrix session identifier is redacted", () => {
    const marker = "U02MATRIXABC123";
    const redacted = redactUrl(`https://adam.unibas.ch/ilias.php;jsessionid=${marker}?ref_id=1`);
    assert.doesNotMatch(redacted, new RegExp(marker));
  });
});
describe("D-01 provenance.sourceUrl", () => {
  it("D-01 provenance.sourceUrl with token is redacted via deepRedact", () => {
    const redacted = deepRedact({
      provenance: { sourceUrl: "https://adam.unibas.ch/go/crs/1?token=secretXYZ" },
    }) as { provenance: { sourceUrl: string } };
    assert.doesNotMatch(redacted.provenance.sourceUrl, /secretXYZ/);
    assert.match(redacted.provenance.sourceUrl, /\[redacted\]/);
  });

  it("D-01 provenance.sourceUrl with password is redacted via deepRedact", () => {
    const redacted = deepRedact({
      provenance: { sourceUrl: "https://adam.unibas.ch/go/crs/1?password=hunter2" },
    }) as { provenance: { sourceUrl: string } };
    assert.doesNotMatch(JSON.stringify(redacted), /hunter2/);
  });
});
describe("D-02 forum posts", () => {
  it("D-02 forum post body with password= is redacted", () => {
    const redacted = deepRedact({ posts: [{ body: "password=hunter2D02" }] }) as {
      posts: Array<{ body: string }>;
    };
    assert.doesNotMatch(JSON.stringify(redacted), /hunter2D02/);
  });

  it("D-02 forum post body with token URL is redacted", () => {
    const redacted = deepRedact({
      posts: [{ body: "see https://adam.unibas.ch/go/crs/1?token=secretD02" }],
    }) as { posts: Array<{ body: string }> };
    assert.doesNotMatch(JSON.stringify(redacted), /secretD02/);
  });
});
describe("D-05 resource_link", () => {
  it("D-05 ok() emits a resource_link block for file handles", () => {
    const response = ok({
      type: "file",
      refId: "42",
      title: "Lecture notes",
      url: "https://adam.unibas.ch/go/file/42",
    });
    const links = response.content.filter((entry) => entry.type === "resource_link") as Array<{
      type: string;
      uri: string;
    }>;
    assert.equal(links.length, 1);
    assert.equal(links[0]!.uri, "adam://file/42");
  });

  it("D-05 resource_link description carries the redacted live citation, never the secret", () => {
    const response = ok({
      type: "file",
      refId: "42",
      title: "T",
      url: "https://adam.unibas.ch/go/file/42?token=secretD05",
    });
    assert.doesNotMatch(JSON.stringify(response), /secretD05/);
    const links = response.content.filter((entry) => entry.type === "resource_link") as Array<{
      description?: string;
    }>;
    assert.match(links[0]!.description ?? "", /\[redacted\]/);
  });
});
describe("D-06 envelope honesty", () => {
  it("D-06 resourceJsonText wraps untrusted envelope with data notice", () => {
    const text = resourceJsonText({ title: "hello" });
    const parsed = JSON.parse(text) as { untrusted?: boolean; notice?: string };
    assert.equal(parsed.untrusted, true);
    assert.match(parsed.notice ?? "", /untrusted/i);
  });

  it("D-06 UntrustedContent.wrap preserves listingNotice distinct from notice", () => {
    const enveloped = UntrustedContent.wrap(
      { items: [], notice: "listing hello" },
      UntrustedContent.DATA_NOTICE,
    ) as { listingNotice?: unknown; notice?: string; untrusted?: boolean };
    assert.equal(enveloped.untrusted, true);
    assert.equal(enveloped.listingNotice, "listing hello");
    assert.equal(enveloped.notice, UntrustedContent.DATA_NOTICE);
  });
});
describe("F-01 fail text", () => {
  it("F-01 fail() redacts password= but keeps code/retryable", () => {
    const response = fail(new AdamError("forbidden", "password=hunter2F01", false));
    const text = (response.content[0] as { text: string }).text;
    assert.doesNotMatch(text, /hunter2F01/);
    assert.match(text, /forbidden:/);
    assert.match(text, /retryable=false/);
  });

  it("F-01 formatAdamFailText redacts Bearer but keeps runId suffix", () => {
    const text = formatAdamFailText(new Error("Authorization: Bearer secretF01XYZ"), "abcd1234");
    assert.doesNotMatch(text, /secretF01XYZ/);
    assert.match(text, /runId=abcd1234/);
  });
});
describe("T-01 runProvider stderr", () => {
  it("T-01 runProvider logs exactly one JSON line without payload contents", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = ((line?: unknown) => {
      lines.push(String(line));
    }) as typeof console.error;
    const marker = "T01PAYLOADSECRETXYZ";
    try {
      const response = await runProvider(async () => ({ title: `hello ${marker}` }), "adam_test_red");
      assert.equal(response.isError, undefined);
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    const line = lines[0]!;
    assert.doesNotMatch(line, /\n/);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed.tool, "adam_test_red");
    assert.equal(parsed.outcome, "ok");
    assert.doesNotMatch(line, new RegExp(marker));
  });
});
describe("O-01/O-02 over-redaction guards", () => {
  it("O-01 legit Secret title stays intact", () => {
    assert.equal(redactText("Secret: The Hidden Garden"), "Secret: The Hidden Garden");
    assert.equal(redactText("The Secret Life of Bees"), "The Secret Life of Bees");
  });

  it("O-02 legit password-recovery prose stays intact", () => {
    assert.equal(
      redactText("password recovery instructions"),
      "password recovery instructions",
    );
  });
});
describe("baseline redaction still holds", () => {
  it("baseline Bearer is redacted", () => {
    assert.doesNotMatch(redactText("Authorization: Bearer super-secret"), /super-secret/);
  });

  it("baseline PHPSESSID is redacted", () => {
    assert.doesNotMatch(redactText("PHPSESSID=php-value"), /php-value/);
  });
});
describe("structured URL carriers", () => {
  it("redacts href/src/download and sensitive scalar fields without relying on text syntax", () => {
    const result = deepRedact({
      href: "https://adam.unibas.ch/file?otp=hrefMarker",
      src: "https://adam.unibas.ch/file#token=srcMarker",
      download: "https://adam.unibas.ch/file?recovery_code=downloadMarker",
      password: "fieldMarker", secret: "secretMarker", otp: 482917,
    });
    assert.doesNotMatch(JSON.stringify(result), /hrefMarker|srcMarker|downloadMarker|fieldMarker|secretMarker|482917/);
  });
  it(
    "D-03 listingNotice smuggling is redacted",
    () => {
      const redacted = deepRedact({
        listingNotice: "see https://adam.unibas.ch/go/crs/1?JSESSIONID=D03SMUGGLEDABC",
      });
      assert.doesNotMatch(JSON.stringify(redacted), /D03SMUGGLEDABC/);
    },
  );

  it(
    "D-04 href/src/download gap is closed via redactUrl",
    () => {
      const redacted = deepRedact({
        href: "https://adam.unibas.ch/go/crs/1?otp=D04OTPABC123",
      });
      assert.doesNotMatch(JSON.stringify(redacted), /D04OTPABC123/);
    },
  );
});
