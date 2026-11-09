/* Zero-dependency static server for local preview and verification.
   Python's http.server does not answer Range requests, which stops <video>
   from seeking. This server does, so the tech scrub and film controls behave
   the same way they will on a normal static host.

   Run: node scripts/serve.mjs
   Then open: http://127.0.0.1:5500
*/
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.PORT || 5500);
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!match) return null;
  let start = match[1] === "" ? null : Number(match[1]);
  let end = match[2] === "" ? null : Number(match[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    end = end === null ? size - 1 : Math.min(end, size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { invalid: true, start, end };
  }
  return { start, end };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || HOST}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = resolve(join(ROOT, normalize(pathname)));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Forbidden");
      return;
    }

    let info;
    try {
      info = await stat(file);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    if (info.isDirectory()) {
      response.writeHead(302, { Location: `${url.pathname.replace(/\/?$/, "/")}index.html` });
      response.end();
      return;
    }

    const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
    const headers = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "Last-Modified": info.mtime.toUTCString(),
    };

    const range = parseRange(request.headers.range, info.size);
    if (range?.invalid) {
      response.writeHead(416, { ...headers, "Content-Range": `bytes */${info.size}` });
      response.end();
      return;
    }

    if (range) {
      const length = range.end - range.start + 1;
      response.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`,
        "Content-Length": String(length),
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(file, { start: range.start, end: range.end }).pipe(response);
      return;
    }

    response.writeHead(200, { ...headers, "Content-Length": String(info.size) });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Server error: ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`STRATA preview: http://${HOST}:${PORT}`);
});
