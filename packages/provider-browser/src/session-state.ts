import { stat } from "node:fs/promises";
import { disabledSessionReason } from "./session-disabled.ts";
import type { SessionStatus } from "./session-types.ts";

/** Passive local evidence only: a profile is never proof of authentication. */
export async function inactiveSessionStatus(profileDir: string): Promise<Pick<SessionStatus, "connectionState" | "recoveryAction" | "message">> {
  const disabledReason = await disabledSessionReason(profileDir);
  if (disabledReason === "logout") return {
    connectionState: "signed-out", recoveryAction: "login",
    message: "Locally signed out. Run adam-mcp login when ready to reconnect.",
  };
  if (disabledReason === "login-failed") return {
    connectionState: "disconnected", recoveryAction: "login",
    message: "The previous sign-in did not complete. Automatic reconnect is disabled until you run adam-mcp login again.",
  };
  let profileExists = false;
  try { profileExists = (await stat(profileDir)).isDirectory(); } catch { /* Missing profile is normal. */ }
  return {
    connectionState: "disconnected", recoveryAction: "login",
    message: profileExists
      ? "The background session is inactive. A local profile exists, but saved sign-in is unverified. Run adam-mcp login to reconnect or sign in."
      : "Sign in to connect ADAM: run adam-mcp login. Complete SWITCH sign-in in Chrome.",
  };
}
