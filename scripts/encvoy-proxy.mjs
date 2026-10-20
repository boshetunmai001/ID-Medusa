import http from "node:http";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.ENCVOY_PORT || 9090);
const dashboardRoot = path.join(root, "research/encvoy-id/packages/dashboard/dist");
const services = [
  { prefix: "/oidc", port: 3003 },
  { prefix: "/.well-known", port: 3003 },
  { prefix: "/api", port: 3005 },
  { prefix: "/public", port: 3005 },
  { prefix: "/docs", port: 3005 },
  { prefix: "/widget", port: 3005 },
  { prefix: "/auth", port: 3007 },
];

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function matchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function proxyRequest(request, response, targetPort) {
  const headers = { ...request.headers };
  headers.host = `127.0.0.1:${targetPort}`;
  headers["x-forwarded-host"] = request.headers.host || "localhost:9090";
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-port"] = String(port);
  headers["x-forwarded-for"] = request.socket.remoteAddress || "127.0.0.1";

  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end("Local Encvoy service unavailable");
  });

  request.pipe(upstream);
  response.on("close", () => upstream.destroy());
}

async function serveDashboard(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end();
    return;
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
      .replace(/^\/+/, "");
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  let filePath = path.resolve(dashboardRoot, relativePath || "index.html");
  if (!filePath.startsWith(`${dashboardRoot}${path.sep}`) && filePath !== dashboardRoot) {
    response.writeHead(400);
    response.end();
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = path.join(filePath, "index.html");
    await access(filePath);
  } catch {
    filePath = path.join(dashboardRoot, "index.html");
    try {
      await access(filePath);
    } catch {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("Local Encvoy dashboard is not built");
      return;
    }
  }

  const fileStat = await stat(filePath);
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  response.writeHead(200, {
    "content-length": fileStat.size,
    "content-type": contentType,
    "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=300",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
}

function handleRequest(request, response) {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end('{"status":"ok","service":"local-encvoy-proxy"}');
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  const service = services.find(({ prefix }) => matchesPrefix(pathname, prefix));
  if (service) {
    proxyRequest(request, response, service.port);
    return;
  }

  void serveDashboard(request, response);
}

const servers = ["127.0.0.1", "::1"].map((host) => {
  const server = http.createServer(handleRequest);
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return { host, server };
});

const listeners = servers.map(
  ({ host, server }) =>
    new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen({ port, host, ipv6Only: host === "::1" }, () => {
        server.off("error", onError);
        resolve();
      });
    }),
);

try {
  await Promise.all(listeners);
} catch (error) {
  console.error(`Could not bind the local Encvoy proxy on port ${port}: ${error.code || "error"}`);
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const { server } of servers) server.close();
    process.exit(0);
  });
}
