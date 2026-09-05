import { AdamError } from "adam-core";

const ALLOWED_EXACT_HOSTS = new Set([
  "adam.unibas.ch",
  "wayf.switch.ch",
  "login.switch.ch",
  "aai.unibas.ch",
  "idp.unibas.ch",
]);

const ALLOWED_HOST_SUFFIXES = ["eduid.ch", "switch.ch"] as const;

export function hostnameAllowed(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  if (ALLOWED_EXACT_HOSTS.has(host)) {
    return true;
  }
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function urlAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      return false;
    }
    if (url.username || url.password) {
      return false;
    }
    return hostnameAllowed(url.hostname);
  } catch {
    return false;
  }
}

export function assertUrlAllowed(raw: string): URL {
  if (!urlAllowed(raw)) {
    throw new AdamError(
      "provider_unavailable",
      `Navigation blocked; host is not on the ADAM/SWITCH HTTPS allowlist: ${raw}`,
    );
  }
  return new URL(raw);
}
