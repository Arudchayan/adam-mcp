import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const demoDir = resolve(root, "docs/demo");
const outDir = join(demoDir, "out");
const bin = join(root, "packages/mcp/dist/adam-mcp.mjs");
const CLIENT_PORT = String(6400 + Math.floor(Math.random() * 200));
const SERVER_PORT = String(Number(CLIENT_PORT) + 3);
const SKIP_TTS = process.env.SKIP_TTS === "1";
const EDGE_TTS = process.env.EDGE_TTS_BIN || "/workspace/yc-demo/venv/bin/edge-tts";

const CAPTION_CSS = `
#adam-demo-caption-wrap {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
  background: #111; color: #fff; font-family: "Segoe UI", system-ui, sans-serif;
  padding: 14px 28px 18px; letter-spacing: 0;
  pointer-events: none;
}
#adam-demo-lower {
  display: none; font: 600 15px/1.2 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.06em; text-transform: uppercase; color: #9ae6b4; margin-bottom: 6px;
}
#adam-demo-lower.show { display: block; }
#adam-demo-caption { font: 500 28px/1.35 "Segoe UI", system-ui, sans-serif; color: #fff; }
#adam-demo-badge {
  display: none; margin-top: 8px; font: 500 14px/1.3 "Segoe UI", system-ui, sans-serif; color: #a0aec0;
}
#adam-demo-badge.show { display: block; }
`;

async function caption(page, text, opts = {}) {
  await page.evaluate(
    ({ css, text: value, lower, badge }) => {
      let style = document.getElementById("adam-demo-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "adam-demo-style";
        style.textContent = css;
        document.head.appendChild(style);
      }
      let wrap = document.getElementById("adam-demo-caption-wrap");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = "adam-demo-caption-wrap";
        wrap.innerHTML =
          '<div id="adam-demo-lower"></div><div id="adam-demo-caption"></div><div id="adam-demo-badge"></div>';
        document.body.appendChild(wrap);
      }
      const lowerEl = document.getElementById("adam-demo-lower");
      const capEl = document.getElementById("adam-demo-caption");
      const badgeEl = document.getElementById("adam-demo-badge");
      capEl.textContent = value;
      if (lower) { lowerEl.textContent = lower; lowerEl.classList.add("show"); }
      else { lowerEl.textContent = ""; lowerEl.classList.remove("show"); }
      if (badge) { badgeEl.textContent = badge; badgeEl.classList.add("show"); }
      else { badgeEl.textContent = ""; badgeEl.classList.remove("show"); }
    },
    { css: CAPTION_CSS, text, lower: opts.lower || "", badge: opts.badge || "" },
  );
}

function spawnInspector() {
  const child = spawn(
    "npx",
    ["-y", "@modelcontextprotocol/inspector", "--web", "node", bin],
    {
      cwd: root,
      env: { ...process.env, CLIENT_PORT, SERVER_PORT, BROWSER: "none", ADAM_PROVIDER: "fixture" },
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
      if (!settled) reject(new Error(`inspector exited ${code}: ${output.slice(-500)}`));
    });
  });
  return { child, url: done };
}

async function connectInspector(page, inspectorUrl) {
  await page.goto(inspectorUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);
  const toggle = page.getByRole("switch").first();
  await toggle.waitFor({ state: "visible" });
  if (!(await toggle.isChecked())) await toggle.click({ force: true });
  await page.getByText("Connected", { exact: false }).first().waitFor({ timeout: 20_000 });
  await page.getByText("Tools", { exact: true }).first().click();
  await page.getByText("adam_list_courses", { exact: true }).waitFor();
}

async function selectTool(page, toolName) {
  const item = page.getByText(toolName, { exact: true }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click({ force: true });
  await page.getByRole("button", { name: "Execute Tool" }).waitFor();
}

async function executeTool(page, toolName, args = {}) {
  await selectTool(page, toolName);
  if (args.query != null) await page.getByLabel(/^query/i).fill(String(args.query));
  if (args.refId != null) await page.getByLabel(/^refId/i).fill(String(args.refId));
  if (args.confirm === true) {
    const confirm = page.getByLabel(/^confirm/i);
    if (!(await confirm.isChecked().catch(() => false))) await confirm.click({ force: true });
  }
  const runBtn = page.getByRole("button", { name: "Execute Tool" });
  if (await runBtn.isEnabled()) await runBtn.click({ force: true });
}

async function recordClip(browser, name, runFn) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  await runFn(page);
  const video = page.video();
  await context.close();
  const dest = join(outDir, `${name}.webm`);
  if (video) {
    await video.saveAs(dest);
    await video.delete().catch(() => undefined);
  }
  return dest;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || demoDir,
      shell: true,
      stdio: "inherit",
      env: { ...process.env, ...(opts.env || {}) },
    });
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

function runCapture(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: demoDir, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.stderr.on("data", (c) => (out += c.toString()));
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(out);
      else reject(new Error(`${cmd} exited ${code}: ${out.slice(-400)}`));
    });
  });
}

async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}

await mkdir(outDir, { recursive: true });
for (const name of await readdir(outDir)) {
  if (/\.(webm|mp4|png|wav|mp3)$/.test(name)) {
    await unlink(join(outDir, name)).catch(() => undefined);
  }
}

const inspector = spawnInspector();
const inspectorUrl = await inspector.url;
console.error("inspector", inspectorUrl.replace(/MCP_INSPECTOR_API_TOKEN=.*/, "MCP_INSPECTOR_API_TOKEN=…"));

const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  await recordClip(browser, "00-title", async (page) => {
    const html =
      "<!doctype html><html><body style=\"margin:0;background:#0b0f14;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif;color:#e2e8f0\">" +
      "<div style=\"text-align:center\"><div style=\"font-size:64px;font-weight:650;letter-spacing:-0.02em\">adam-mcp</div>" +
      "<div style=\"margin-top:18px;font-size:28px;color:#94a3b8\">ADAM, for the AI tools you already use</div>" +
      "<div style=\"margin-top:28px;font-size:16px;color:#64748b\">Uni Basel · community · local-first · fixture demo</div></div></body></html>";
    await page.goto("data:text/html," + encodeURIComponent(html), { waitUntil: "domcontentloaded" });
    await caption(page, "So I built adam-mcp — ADAM, for the AI tools you already use.", { lower: "adam-mcp" });
    await page.waitForTimeout(5500);
  });

  await recordClip(browser, "01-news", async (page) => {
    await connectInspector(page, inspectorUrl);
    await caption(page, "Ask what changed in ADAM this week.", {
      lower: "adam-mcp",
      badge: "fixture catalog · real MCP Inspector",
    });
    await executeTool(page, "adam_list_news");
    await page.getByText("https://adam.unibas.ch/go/file/100011").first().waitFor();
    await page.waitForTimeout(7500);
  });

  await recordClip(browser, "02-courses", async (page) => {
    await connectInspector(page, inspectorUrl);
    await caption(page, "Pull every deadline — courses and calendar, with ADAM URLs.", { lower: "adam-mcp" });
    await executeTool(page, "adam_list_courses");
    await page.getByText("https://adam.unibas.ch/go/crs/100001").first().waitFor();
    await page.waitForTimeout(3500);
    await caption(page, "Deadlines from calendar + exercises, cited back to ADAM.", { lower: "adam-mcp" });
    await executeTool(page, "adam_list_calendar");
    await page.getByText("Retrieval summary deadline").first().waitFor();
    await page.waitForTimeout(5500);
  });

  await recordClip(browser, "03-search", async (page) => {
    await connectInspector(page, inspectorUrl);
    await caption(page, "Search the reading. Open the page.", { lower: "adam-mcp" });
    await executeTool(page, "adam_search", { query: "Fourier" });
    await page.getByText("https://adam.unibas.ch/go/crs/100001").first().waitFor();
    await page.waitForTimeout(4000);
    await caption(page, "adam_read_page — confirm gate, then course text + Lecture Hall A.", { lower: "adam-mcp" });
    await executeTool(page, "adam_read_page", { refId: "100001", confirm: true });
    await page.getByText("Lecture Hall A").first().waitFor();
    await page.waitForTimeout(5500);
  });

  await recordClip(browser, "04-exercise", async (page) => {
    await connectInspector(page, inspectorUrl);
    await caption(page, "Same ADAM — seconds, not a scavenger hunt.", {
      lower: "adam-mcp",
      badge: "labeled synthetic · refId 100021 · no submit",
    });
    await executeTool(page, "adam_get_exercise", { refId: "100021" });
    await page.getByText("Exercise 1").first().waitFor();
    await page.waitForTimeout(6500);
  });

  await recordClip(browser, "05-trust", async (page) => {
    await page.goto("https://adam.unibas.ch/login.php", { waitUntil: "domcontentloaded" });
    await caption(
      page,
      "Runs on your machine. Uses your Chrome session. No cloud tunnel of your SWITCH login.",
      { lower: "local-first" },
    );
    await page.waitForTimeout(8500);
  });

  await recordClip(browser, "06-github", async (page) => {
    await page.goto("https://github.com/Arudchayan/adam-mcp", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => { document.querySelector("#readme")?.setAttribute("hidden", ""); });
    await caption(page, "Open source. github.com/Arudchayan/adam-mcp", { lower: "star · clone · contribute" });
    await page.waitForTimeout(5000);
  });
} finally {
  await browser.close();
  inspector.child.kill();
}

const clips = [
  { name: "00-title", ss: 0.3, t: 5.0 },
  { name: "01-news", ss: 2.0, t: 8.0 },
  { name: "02-courses", ss: 2.5, t: 10.0 },
  { name: "03-search", ss: 2.5, t: 10.0 },
  { name: "04-exercise", ss: 2.0, t: 7.5 },
  { name: "05-trust", ss: 0.8, t: 8.5 },
  { name: "06-github", ss: 1.2, t: 5.5 },
];

const mp4s = [];
for (const clip of clips) {
  const webm = join(outDir, `${clip.name}.webm`);
  const mp4 = join(outDir, `${clip.name}.mp4`);
  await run("ffmpeg", [
    "-y", "-ss", String(clip.ss), "-t", String(clip.t), "-i", webm,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", mp4,
  ]);
  mp4s.push(mp4);
}

const listFile = join(outDir, "concat.txt");
await writeFile(listFile, mp4s.map((file) => `file '${file.replace(/\\/g, "/")}'`).join("\n"));
const concat = join(outDir, "concat.mp4");
await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", concat]);

const silentMaster = join(outDir, "adam-mcp-demo-yc-actb-silent.mp4");
await run("ffmpeg", [
  "-y", "-i", concat, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", silentMaster,
]);

const finalMp4 = join(demoDir, "adam-mcp-demo-yc-actb.mp4");
const narrationMp3 = join(outDir, "narration.mp3");
const narrationTxt = join(demoDir, "narration.txt");
const narrationSrt = join(demoDir, "narration.srt");

const NARRATION = [
  "So I built adam-mcp — ADAM, for the AI tools you already use.",
  "",
  "Ask what changed. Pull every deadline. Search the reading. Open the page.",
  "",
  "Same ADAM — seconds, not a scavenger hunt.",
  "",
  "Runs on your machine. Uses your Chrome session. No cloud tunnel of your SWITCH login.",
  "",
  "Open source. github.com/Arudchayan/adam-mcp.",
].join("\n");

await writeFile(narrationTxt, NARRATION + "\n");

const srt = [
  "1",
  "00:00:00,000 --> 00:00:05,000",
  "So I built adam-mcp — ADAM, for the AI tools you already use.",
  "",
  "2",
  "00:00:05,000 --> 00:00:16,000",
  "Ask what changed.",
  "",
  "3",
  "00:00:16,000 --> 00:00:32,000",
  "Pull every deadline. Courses and calendar, with ADAM URLs.",
  "",
  "4",
  "00:00:32,000 --> 00:00:50,000",
  "Search the reading. Open the page.",
  "",
  "5",
  "00:00:50,000 --> 00:00:59,000",
  "Same ADAM — seconds, not a scavenger hunt.",
  "",
  "6",
  "00:00:59,000 --> 00:01:07,000",
  "Runs on your machine. Uses your Chrome session. No cloud tunnel of your SWITCH login.",
  "",
  "7",
  "00:01:07,000 --> 00:01:12,000",
  "Open source. github.com/Arudchayan/adam-mcp.",
  "",
].join("\n");
await writeFile(narrationSrt, srt);

let usedAudio = false;
if (!SKIP_TTS && (await pathExists(EDGE_TTS))) {
  try {
    await run(
      EDGE_TTS,
      ["--voice", "en-US-BrianNeural", "--rate", "+5%", "--write-media", narrationMp3, "-f", narrationTxt],
      { cwd: outDir },
    );
    const mixed = join(outDir, "adam-mcp-demo-yc-actb-vo.mp4");
    await run("ffmpeg", [
      "-y", "-i", silentMaster, "-i", narrationMp3,
      "-filter_complex", "[1:a]apad[a]",
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
      "-shortest", "-movflags", "+faststart", mixed,
    ]);
    await copyFile(mixed, finalMp4);
    usedAudio = true;
    console.error("muxed VO →", finalMp4);
  } catch (err) {
    console.error("TTS/mux failed, keeping silent master:", err?.message || err);
    await copyFile(silentMaster, finalMp4);
  }
} else {
  console.error("TTS skipped (SKIP_TTS or missing edge-tts); silent master + SRT");
  await copyFile(silentMaster, finalMp4);
}

const ycCopy = "/workspace/yc-demo/adam-mcp-demo-yc-actb.mp4";
await mkdir("/workspace/yc-demo", { recursive: true });
await copyFile(finalMp4, ycCopy);

const probe = await runCapture("ffprobe", [
  "-v", "error", "-show_entries", "format=duration,size",
  "-of", "default=noprint_wrappers=1", finalMp4,
]);
console.error("wrote", finalMp4);
console.error("copied", ycCopy);
console.error("probe", probe.trim());
console.error("audio", usedAudio ? "edge-tts BrianNeural" : "silent+srt");
