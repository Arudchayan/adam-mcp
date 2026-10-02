import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  inputResponse,
} from "@modelcontextprotocol/server";
import { AdamError } from "adam-core";

/**
 * ADR 0019 — elicitation spike (additive, capability-gated).
 *
 * `confirm: true` stays the interim schema gate after the student asked to
 * read. Real confirms go to MCP elicitation when the host supports MRTR.
 * One write-once `inputRequired` return shape serves both eras: the legacy
 * shim (default on) fulfils it via `elicitation/create` on 2025 connections.
 *
 * Elicited content is untrusted — only a boolean gate is read, never echoed
 * into provider payloads, logs, or citations. Elicitation never carries
 * passwords or cookies.
 */

/** 10-minute human-paced round timeout (spike value; legs are human-paced). */
export const ELICITATION_ROUND_TIMEOUT_MS = 600_000;

/**
 * Flat-primitive elicitation schema: boolean `confirm` only.
 * `requestedSchema` supports flat primitives only (string, number, integer,
 * boolean, string enums) — this shape is intentionally minimal.
 */
export const CONFIRM_ELICITATION_REQUESTED_SCHEMA = {
  type: "object",
  properties: {
    confirm: {
      type: "boolean",
      description: "Yes, open it",
    },
  },
  required: ["confirm"],
  additionalProperties: false,
} as const;

/** Re-exported for handler wiring (acceptedContent → boolean gate). */
export { acceptedContent, inputResponse };

/**
 * Write-once elicitation request: check `acceptedContent` first; if missing,
 * return this. The shim covers 2025 hosts.
 */
export function requestConfirmElicitation(toolName: string) {
  return inputRequired({
    inputRequests: {
      confirm: inputRequired.elicit({
        message: `${toolName} requires confirm:true after the student asked to read. Confirm to proceed.`,
        requestedSchema: CONFIRM_ELICITATION_REQUESTED_SCHEMA as unknown as {
          type: "object";
          properties: { confirm: { type: "boolean" } };
          required: ["confirm"];
        },
      }),
    },
  });
}

/**
 * Elicited content is untrusted — only a strict boolean `true` gate is read.
 * Never echo the content into payloads, logs, or citations.
 */
export function isElicitedYes(content: unknown): boolean {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return false;
  }
  return (content as { confirm?: unknown }).confirm === true;
}

export type ElicitationOutcome = "accepted-yes" | "accepted-no" | "declined" | "cancelled" | "missing";

/**
 * Discriminated view of one `inputResponses` entry (decline/cancel detection).
 * Values arrive from the client and are untrusted — validate elicitation
 * content via `acceptedContent` / `isElicitedYes` where it matters.
 */
export function elicitationOutcome(inputResponses: unknown, key = "confirm"): ElicitationOutcome {
  const view = inputResponse(inputResponses as Record<string, unknown>, key) as
    | { kind: "missing" }
    | { kind: "elicit"; action: "accept" | "decline" | "cancel"; content?: unknown }
    | { kind: string };
  if (!view || view.kind !== "elicit") {
    return "missing";
  }
  const elicitView = view as { action: string; content?: unknown };
  if (elicitView.action === "decline") {
    return "declined";
  }
  if (elicitView.action === "cancel") {
    return "cancelled";
  }
  return isElicitedYes(elicitView.content) ? "accepted-yes" : "accepted-no";
}

type LegacyCapableServer = {
  server?: { getClientCapabilities?: () => unknown };
  getClientCapabilities?: () => unknown;
};

/**
 * Additive capability check, fail-closed to `false` when unknown.
 * Modern per-request envelope `clientCapabilities.elicitation`, else legacy
 * initialize-declared `getClientCapabilities()?.elicitation`.
 */
export function clientSupportsElicitation(ctx: unknown, server?: unknown): boolean {
  try {
    const record = (ctx ?? {}) as Record<string, unknown>;
    const mcpReq = record.mcpReq as Record<string, unknown> | undefined;
    const envelope = (mcpReq?.envelope ?? record.envelope) as Record<string, unknown> | undefined;
    if (envelope !== undefined && envelope !== null) {
      const caps = (envelope[CLIENT_CAPABILITIES_META_KEY as string] ??
        envelope.clientCapabilities) as { elicitation?: unknown } | undefined;
      if (caps !== undefined && caps !== null) {
        return !!(caps as { elicitation?: unknown }).elicitation;
      }
      // Modern envelope present but no capability view — fail closed.
      return false;
    }
  } catch {
    return false;
  }
  try {
    const candidates: Array<() => unknown> = [];
    const s = server as LegacyCapableServer | undefined;
    if (typeof s?.server?.getClientCapabilities === "function") {
      candidates.push(() => s.server!.getClientCapabilities!());
    }
    if (typeof s?.getClientCapabilities === "function") {
      candidates.push(() => (s as LegacyCapableServer).getClientCapabilities!());
    }
    const ctxServer = (ctx as { server?: { getClientCapabilities?: () => unknown } } | undefined)?.server;
    if (typeof ctxServer?.getClientCapabilities === "function") {
      candidates.push(() => ctxServer.getClientCapabilities!());
    }
    for (const get of candidates) {
      const caps = get() as { elicitation?: unknown } | undefined;
      if (caps && typeof caps === "object" && "elicitation" in caps) {
        return !!caps.elicitation;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Decline/cancel re-entries use distinct safe text with the same
 * `confirmation_required` code (no data leak, no `-32021` to the model).
 */
export function declineFallbackError(
  toolName: string,
  outcome: "declined" | "cancelled" | ElicitationOutcome,
): AdamError {
  const verb = outcome === "cancelled" ? "cancelled" : "declined";
  return new AdamError(
    "confirmation_required",
    `${toolName} confirmation was ${verb} via elicitation; requires confirm:true after the student asked to read.`,
  );
}
