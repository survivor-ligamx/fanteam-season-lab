import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const HOST = "127.0.0.1";
const PORT = Number(process.env.E2E_PORT || 4173);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    const relativePath = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const filePath = resolve(ROOT, relativePath);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
    });
    response.end(body);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(status === 404 ? "Not found" : "Internal server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`E2E server listening at http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
