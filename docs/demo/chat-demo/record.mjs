import { createServer } from "node:http";
import { readFile, mkdir, unlink, readdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dir, "out");
const PORT = 8765;
const CHROME =
  process.env.CHROME_PATH ||
  "/home/box/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const f of await readdir(outDir)) {
    if (f.endsWith(".webm")) await unlink(join(outDir, f)).catch(() => {});
  }

  const server = createServer(async (req, res) => {
    try {
      let path = (req.url || "/").split("?")[0];
      if (path === "/") path = "/index.html";
      const file = join(__dir, path);
      const data = await readFile(file);
      const ext = path.slice(path.lastIndexOf("."));
      res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("nope");
    }
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  const video = page.video();
  await page.goto(`http://127.0.0.1:${PORT}/?autoplay=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.demoDone === "1", null, {
    timeout: 180_000,
  });
  await page.waitForTimeout(1000);
  await page.close();
  const tmpPath = video ? await video.path() : null;
  await context.close();
  await browser.close();
  server.close();

  const dest = join(outDir, "chat-actb.webm");
  if (tmpPath) {
    await rename(tmpPath, dest);
  }
  for (const f of await readdir(outDir)) {
    if (f.endsWith(".webm") && f !== "chat-actb.webm") {
      await unlink(join(outDir, f)).catch(() => undefined);
    }
  }
  console.log("Wrote", dest);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
