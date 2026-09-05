import { spawn } from "node:child_process";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const demoDir = resolve(root, "docs/demo");
const outDir = join(demoDir, "out");
const bin = join(root, "packages/mcp/dist/adam-mcp.mjs");
const CLIENT_PORT = String(6400 + Math.floor(Math.random() * 200));
const SERVER_PORT = String(Number(CLIENT_PORT) + 3);

const CAPTION_CSS = `
#adam-demo-caption {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2147483647;
  background: #111;
  color: #fff;
  font: 500 28px/1.35 "Segoe UI", system-ui, sans-serif;
  padding: 16px 28px 20px;
  letter-spacing: 0;
}
`;

async function caption(page, text) {
  await page.evaluate(
    ({ css, text: value }) => {
      let style = document.getElementById("adam-demo-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "adam-demo-style";
        style.textContent = css;
        document.head.appendChild(style);
      }
      let el = document.getElementById("adam-demo-caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "adam-demo-caption";
        document.body.appendChild(el);
      }
      el.textContent = value;
    },
    { css: CAPTION_CSS, text },
  );
}

function spawnInspector() {
  const child = spawn(
    "npx",
    ["-y", "@modelcontextprotocol/inspector", "--web", "node", bin],
    {
      cwd: root,
      env: { ...process.env, CLIENT_PORT, SERVER_PORT, BROWSER: "none" },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const done = new Promise((resolvePromise, reject) => {
    let settled = false;
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\?MCP_INSPECTOR_API_TOKEN=\S+/);
      if (match && !settled) {
        settled = true;
        resolvePromise(match[0].replace(/\/$/, ""));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      if (!settled) {
        reject(new Error(`inspector exited ${code}: ${output.slice(-500)}`));
      }
    });
  });
  return { child, url: done };
}

async function connectInspector(page, inspectorUrl) {
  await page.goto(inspectorUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);
  const toggle = page.getByRole("switch").first();
  await toggle.waitFor({ state: "visible" });
  if (!(await toggle.isChecked())) {
    await toggle.click({ force: true });
  }
  await page.getByText("Connected", { exact: false }).first().waitFor({ timeout: 20_000 });
  await page.getByText("Tools", { exact: true }).first().click();
  await page.getByText("adam_list_courses", { exact: true }).waitFor();
}

async function executeTool(page, toolName, args) {
  await page.getByText(toolName, { exact: true }).click();
  await page.getByRole("button", { name: "Execute Tool" }).waitFor();
  if (args?.query) {
    await page.getByLabel(/^query/i).fill(String(args.query));
  }
  if (args?.refId) {
    await page.getByLabel(/^refId/i).fill(String(args.refId));
  }
  if (args?.confirm === true) {
    await page.getByLabel(/^confirm/i).click({ force: true });
  }
  const run = page.getByRole("button", { name: "Execute Tool" });
  if (await run.isEnabled()) {
    await run.click();
  }
}

async function recordClip(browser, name, run) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  await run(page);
  const video = page.video();
  await context.close();
  const dest = join(outDir, `${name}.webm`);
  if (video) {
    await video.saveAs(dest);
    await video.delete().catch(() => undefined);
  }
  return dest;
}

function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: demoDir, shell: true, stdio: "inherit" });
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

await mkdir(outDir, { recursive: true });
for (const name of await readdir(outDir)) {
  if (name.endsWith(".webm") || name.endsWith(".mp4") || name.endsWith(".png")) {
    await unlink(join(outDir, name)).catch(() => undefined);
  }
}

const inspector = spawnInspector();
const inspectorUrl = await inspector.url;
console.error("inspector", inspectorUrl.replace(/MCP_INSPECTOR_API_TOKEN=.*/, "MCP_INSPECTOR_API_TOKEN=…"));

const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  await recordClip(browser, "01-news", async (page) => {
    await connectInspector(page, inspectorUrl);
    await caption(page, "What changed in my ADAM courses this week?");
    await executeTool(page, "adam_list_news");
    await page.getByText("https://adam.unibas.ch/go/file/100011").first().waitFor();
    await page.waitForTimeout(7000);
  });

  await recordClip(browser, "02-chrome", async (page) => {
    await page.goto("https://adam.unibas.ch/login.php", { waitUntil: "domcontentloaded" });
    await caption(page, "Uses your local ADAM browser session.");
    await page.waitForTimeout(8000);
  });

  await recordClip(browser, "03-courses", async (page) => {
    await connectInspector(page, inspectorUrl);
    await caption(page, "Courses and deadlines, with ADAM URLs.");
    await executeTool(page, "adam_list_courses");
    await page.getByText("https://adam.unibas.ch/go/crs/100001").first().waitFor();
    await page.waitForTimeout(4000);
    await executeTool(page, "adam_list_calendar");
    await page.getByText("Exercise 1 deadline").first().waitFor();
    await page.waitForTimeout(5000);
  });

  await recordClip(browser, "04-search", async (page) => {
    await connectInspector(page, inspectorUrl);
    await caption(page, "Find the Fourier reading. Summarize the course page.");
    await executeTool(page, "adam_search", { query: "Fourier" });
    await page.getByText("https://adam.unibas.ch/go/crs/100001").first().waitFor();
    await page.waitForTimeout(4000);
    await executeTool(page, "adam_read_page", { refId: "100001", confirm: true });
    await page.getByText("Lecture Hall A").first().waitFor();
    await page.waitForTimeout(5000);
  });

  await recordClip(browser, "06-github", async (page) => {
    await page.goto("https://github.com/Arudchayan/adam-mcp", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.querySelector("#readme")?.setAttribute("hidden", "");
    });
    await caption(page, "github.com/Arudchayan/adam-mcp");
    await page.waitForTimeout(4000);
  });
} finally {
  await browser.close();
  inspector.child.kill();
}

const clips = [
  { name: "01-news", ss: 6, t: 11 },
  { name: "02-chrome", ss: 1.2, t: 8 },
  { name: "03-courses", ss: 10, t: 16 },
  { name: "04-search", ss: 7, t: 19 },
  { name: "06-github", ss: 4.5, t: 4 },
];
const mp4s = [];
for (const clip of clips) {
  const webm = join(outDir, `${clip.name}.webm`);
  const mp4 = join(outDir, `${clip.name}.mp4`);
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(clip.ss),
    "-t",
    String(clip.t),
    "-i",
    webm,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    mp4,
  ]);
  mp4s.push(mp4);
}

const listFile = join(outDir, "concat.txt");
await writeFile(listFile, mp4s.map((file) => `file '${file.replace(/\\/g, "/")}'`).join("\n"));
const concat = join(outDir, "concat.mp4");
await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", concat]);

const finalMp4 = join(demoDir, "adam-mcp-demo.mp4");
await run("ffmpeg", [
  "-y",
  "-i",
  concat,
  "-an",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  finalMp4,
]);

await run("ffmpeg", [
  "-y",
  "-i",
  finalMp4,
  "-t",
  "8",
  "-vf",
  "fps=10,scale=960:-1:flags=lanczos",
  join(demoDir, "demo.gif"),
]);

console.error("wrote", finalMp4);
