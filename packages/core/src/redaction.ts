const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKENISH_QUERY = /([?&](?:token|access_token|session|sid|phpsessid|jwt|php?sessid)=)[^&]+/gi;
const COOKIE_HEADER = /((?:set-)?cookie\s*[:=]\s*)[^\r\n]*/gi;
const BEARER = /(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi;
const BASIC = /(authorization\s*[:=]\s*basic\s+)[^\s]+/gi;
const PHPSESSID = /phpsessid\s*[:=]\s*[^\s;]+/gi;
const SHIBSESSION = /_shibsession_[A-Za-z0-9_-]+\s*=\s*[^\s;]+/g;
const SAML_PARAM = /((?:samlrequest|samlresponse|samlart|relaystate)\s*[:=]\s*)[^\s;&"']+/gi;

export function redactText(value: string): string {
  return value
    .replace(EMAIL, "[redacted-email]")
    .replace(BEARER, "$1[redacted]")
    .replace(BASIC, "$1[redacted]")
    .replace(PHPSESSID, "PHPSESSID=[redacted]")
    .replace(SHIBSESSION, "_shibsession_=[redacted]")
    .replace(SAML_PARAM, "$1[redacted]")
    .replace(TOKENISH_QUERY, "$1[redacted]")
    .replace(COOKIE_HEADER, "$1[redacted]");
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|session|sid|jwt|cookie|phpsessid|saml|relaystate|shib/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return redactText(url.toString());
  } catch {
    return redactText(value);
  }
}
