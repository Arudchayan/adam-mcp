import { AdamError, redactUrl, throwIfCancelled } from "adam-core";
import { waitForSignal } from "./request-lifecycle.ts";

/** Unknown destination paths can themselves be bearer capabilities. */
function publicDestinationMetadata(destination: URL): string {
  const segments = destination.pathname.split("/").filter(Boolean);
  const reservedGitHubPaths = new Set(["login", "logout", "join", "signup", "settings", "sessions", "apps", "account", "password_reset", "users", "organizations"]);
  // A public GitHub repository identity is not an invite/download capability.
  // Other path schemas are not established by our selected capture: omit them.
  const repositoryIdentity = destination.hostname === "github.com" && segments.length === 2 &&
    !reservedGitHubPaths.has(segments[0]!.toLowerCase()) &&
    /^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(segments[0]!) && /^[a-z0-9_.-]{1,100}$/i.test(segments[1]!);
  if (!repositoryIdentity) destination.pathname = "/";
  destination.search = "";
  destination.hash = "";
  return redactUrl(destination.href);
}

/** Only the observed, row-local read-only Web Link launch route is eligible. */
export function webLinkLaunchUrl(href: string, refId: string): string | undefined {
  if (!/^\d+$/.test(refId)) return undefined;
  try {
    const url = new URL(href, "https://adam.unibas.ch");
    if (url.origin !== "https://adam.unibas.ch" || url.username || url.password || url.hash || url.pathname !== "/ilias.php") return undefined;
    const pairs = [...url.searchParams];
    if (new Set(pairs.map(([key]) => key.toLowerCase())).size !== pairs.length) return undefined;
    if (pairs.some(([key]) => !["baseClass", "cmdNode", "cmdClass", "cmd", "ref_id", "link_id"].includes(key))) return undefined;
    if (url.searchParams.get("baseClass")?.toLowerCase() !== "illinkresourcehandlergui" ||
        url.searchParams.get("cmdClass")?.toLowerCase() !== "ilobjlinkresourcegui" ||
        url.searchParams.get("cmd") !== "callLink" || url.searchParams.get("ref_id") !== refId ||
        !/^\d+$/.test(url.searchParams.get("link_id") ?? "")) return undefined;
    if (url.searchParams.has("cmdNode") && !/^[a-z0-9:]+$/i.test(url.searchParams.get("cmdNode")!)) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Read only ADAM's redirect header. Never request the destination or response body. */
export async function readWebLinkRedirect(href: string, refId: string, host: {
  headers: (url: string) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
}, signal?: AbortSignal): Promise<{ url: string; sourceUrl: string } | undefined> {
  const target = webLinkLaunchUrl(href, refId);
  if (!target) throw new AdamError("unsupported_type", "This is not a verified selected ADAM Web Link route.", false);
  throwIfCancelled(signal);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new AdamError("provider_unavailable", "ADAM Web Link resolution timed out.", true)), 15_000);
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  let response: Response | undefined;
  try {
    const headers = await waitForSignal(host.headers(target), combined);
    combined.throwIfAborted();
    const pending = (host.fetch ?? fetch)(target, { headers, redirect: "manual", signal: combined });
    void pending.then((late) => { if (combined.aborted) void late.body?.cancel().catch(() => undefined); }, () => {});
    response = await waitForSignal(pending, combined);
    combined.throwIfAborted();
    if ([401, 403].includes(response.status)) throw new AdamError(response.status === 401 ? "unauthorized" : "forbidden", "ADAM refused the selected Web Link.", false);
    if (response.status === 429 || response.status >= 500) throw new AdamError("provider_unavailable", "ADAM could not resolve the selected Web Link.", true);
    if (![301, 302, 303, 307, 308].includes(response.status)) return undefined;
    const location = response.headers.get("location");
    if (!location) return undefined;
    const destination = new URL(location, target);
    const hostName = destination.hostname.toLowerCase();
    const authenticationHost = ["wayf.switch.ch", "login.switch.ch", "aai.unibas.ch", "idp.unibas.ch"].includes(hostName) ||
      hostName === "eduid.ch" || hostName.endsWith(".eduid.ch");
    const internalLogin = destination.origin === "https://adam.unibas.ch" &&
      (/login|shibboleth|saml|oauth/i.test(destination.pathname) ||
       /login/i.test(destination.searchParams.get("cmd") ?? "") ||
       /ilstartupgui/i.test(destination.searchParams.get("baseClass") ?? ""));
    if (authenticationHost || internalLogin) throw new AdamError("unauthorized", "The ADAM Web Link redirected to sign-in. Reconnect ADAM before retrying.", false);
    if (destination.protocol !== "https:" || destination.username || destination.password || destination.origin === "https://adam.unibas.ch") return undefined;
    // Destination query keys are not a known ADAM schema. Omit all query and
    // fragment values rather than guessing every cloud/vendor signature name.
    return { url: publicDestinationMetadata(destination), sourceUrl: target };
  } finally {
    clearTimeout(timeout);
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
  }
}
