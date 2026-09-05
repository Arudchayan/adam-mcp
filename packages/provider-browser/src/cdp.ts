export function parseDevToolsActivePort(raw: string): number | undefined {
  const port = Number(raw.split(/\r?\n/)[0]?.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }
  return port;
}

export function localCdpEndpoint(port: number): string {
  return `http://127.0.0.1:${port}`;
}
