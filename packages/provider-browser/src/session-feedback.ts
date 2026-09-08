import type { Page } from "playwright-core";

export type SessionFeedbackKind = "success" | "error";

const FEEDBACK_ROOT_ID = "adam-mcp-session-feedback";

export const DEFAULT_FEEDBACK_HOLD_MS = 5_000;

export function sessionFeedbackDocument(kind: SessionFeedbackKind, headline: string, detail: string): string {
  const ok = kind === "success";
  const accent = ok ? "#7C1D2E" : "#8A3A12";
  const mark = ok ? "✓" : "!";
  const caption = ok ? "Signed in" : "Sign-in did not finish";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(caption)} — ADAM MCP</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", sans-serif;
      background: #F3EDE4;
      color: #1C1412;
    }
    .panel {
      min-height: 100%;
      display: grid;
      place-items: center;
      padding: 32px 20px;
    }
    .card {
      width: min(440px, 100%);
      background: #FFFCFA;
      border: 1px solid #E2D6C8;
      border-radius: 2px;
      padding: 36px 32px 28px;
      box-shadow: 0 18px 40px rgba(28, 20, 18, 0.08);
    }
    .mark {
      width: 48px; height: 48px;
      display: grid; place-items: center;
      background: ${accent};
      color: #F7F1E8;
      font-size: 26px;
      font-weight: 600;
      margin-bottom: 22px;
    }
    h1 {
      font-family: Palatino, "Palatino Linotype", "Iowan Old Style", Georgia, serif;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 500;
      margin: 0 0 10px;
      letter-spacing: -0.02em;
    }
    p { margin: 0 0 12px; line-height: 1.45; color: #4A3F38; font-size: 15px; }
    .meta { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #8A7A70; margin-bottom: 18px; }
    .count { font-variant-numeric: tabular-nums; color: ${accent}; font-weight: 600; }
    footer { margin-top: 22px; font-size: 12px; color: #8A7A70; }
  </style>
</head>
<body>
  <div class="panel">
    <div class="card">
      <div class="mark" aria-hidden="true">${mark}</div>
      <div class="meta">ADAM MCP · unofficial</div>
      <h1>${escapeHtml(headline)}</h1>
      <p>${escapeHtml(detail)}</p>
      <p>${ok
        ? `Closes in <span class="count" id="adam-mcp-count">5</span>s.`
        : `This window stays open. Close it when you are done.`}</p>
      <footer>Unofficial community tool. Not a University of Basel service.</footer>
    </div>
  </div>
  <script>
    let left = 5;
    const el = document.getElementById("adam-mcp-count");
    const tick = setInterval(() => {
      left -= 1;
      if (el) el.textContent = String(Math.max(left, 0));
      if (left <= 0) clearInterval(tick);
    }, 1000);
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function showSessionFeedback(
  page: Page,
  kind: SessionFeedbackKind,
  headline: string,
  detail: string,
  options: {
    holdMs?: number;
    hideWindow?: boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const holdMs = options.holdMs ?? DEFAULT_FEEDBACK_HOLD_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const html = sessionFeedbackDocument(kind, headline, detail);
  try {
    await page.evaluate(`(() => {
      const rootId = ${JSON.stringify(FEEDBACK_ROOT_ID)};
      const documentHtml = ${JSON.stringify(html)};
      document.getElementById(rootId)?.remove();
      const host = document.createElement("iframe");
      host.id = rootId;
      host.setAttribute("role", "dialog");
      host.setAttribute("aria-live", "polite");
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647;width:100%;height:100%;border:0;background:#F3EDE4;";
      document.documentElement.appendChild(host);
      const doc = host.contentDocument;
      if (doc) {
        doc.open();
        doc.write(documentHtml);
        doc.close();
      }
    })()`);
  } catch {
    return;
  }
  if (holdMs > 0) {
    await sleep(holdMs);
  }
  if (kind === "success" && options.hideWindow !== false) {
    await minimizeChromeWindow(page);
  }
}

export async function minimizeChromeWindow(page: Page): Promise<void> {
  try {
    const client = await page.context().newCDPSession(page);
    const { windowId } = (await client.send("Browser.getWindowForTarget")) as { windowId: number };
    await client.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
  } catch {
    // Keep the window if CDP cannot hide it. Never close the context here.
  }
}
