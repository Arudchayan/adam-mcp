import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const path = req.url === "/" || req.url?.startsWith("/?") ? "/index.html" : (req.url ?? "/").split("?")[0];
  const file = join(root, path.replace(/^\//, ""));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(4177, "127.0.0.1", () => {
  console.error("ADAM MCP demo: http://127.0.0.1:4177/");
});
