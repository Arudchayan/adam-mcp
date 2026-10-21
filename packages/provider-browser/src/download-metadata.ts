export function filenameFromContentDisposition(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")).replace(/^.*[/\\]/, "") || undefined;
    } catch {
      // fall through
    }
  }
  const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  const raw = (plain?.[1] ?? plain?.[2])?.trim().replace(/^"|"$/g, "");
  if (!raw) {
    return undefined;
  }
  return raw.replace(/^.*[/\\]/, "") || undefined;
}
