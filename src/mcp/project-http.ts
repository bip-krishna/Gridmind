import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createProjectMemoryServer, project } from "./project-memory";

const MAX_BODY = 64 * 1024;
const MAX_SESSIONS = 32;
const SESSION_IDLE_MS = 30 * 60 * 1000;

/** A project-specific key. The file is a local credential, never a shareable URL. */
function readOrCreateToken(file: string) {
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(parent).isSymbolicLink()) throw new Error("HTTP token directory must not be a symlink");
  try {
    fs.writeFileSync(file, randomBytes(32).toString("base64url") + "\n", { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
  }
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 256 || stat.size < 32) throw new Error("Invalid HTTP token file");
    if (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))) {
      throw new Error("HTTP token file must be owned by you with owner-only permissions (chmod 600)");
    }
    const token = fs.readFileSync(descriptor, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Invalid HTTP token file");
    return token;
  } finally { fs.closeSync(descriptor); }
}

function respond(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") throw new Error("encoding");
  const length = Number(req.headers["content-length"] || 0);
  if (!Number.isFinite(length) || length > MAX_BODY) throw new Error("size");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY) throw new Error("size");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

type HttpOptions = { port?: number; tokenFile?: string; readOnly?: boolean };

/**
 * Start a loopback-only MCP endpoint for GUI clients that support bearer headers.
 * This is deliberately not an OAuth or public hosting service. ChatGPT's private
 * Secure MCP Tunnel can launch the ordinary stdio command without this listener.
 */
export async function startHttp(options: HttpOptions = {}) {
  const port = options.port ?? 47831;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("HTTP port must be an integer between 0 and 65535");
  const info = project();
  const tokenFile = path.resolve(options.tokenFile || path.join(info.directory, "http-token"));
  const token = Buffer.from(readOrCreateToken(tokenFile));
  const readOnly = options.readOnly !== false;
  type Entry = { transport: StreamableHTTPServerTransport; memory: ReturnType<typeof createProjectMemoryServer>; touched: number; requests: number };
  const sessions = new Map<string, Entry>();
  const pending = new Set<Entry>();
  let actualPort = port;
  let closing = false;

  async function discard(entry: Entry) {
    pending.delete(entry);
    if (entry.transport.sessionId) sessions.delete(entry.transport.sessionId);
    entry.memory.finish();
    await entry.memory.server.close().catch(() => undefined);
  }

  const http = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const host = req.headers.host?.toLowerCase();
      if (host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) return respond(res, 403, "Only the local Gridmind host is allowed");
      const origin = req.headers.origin;
      if ((origin && origin !== `http://${host}`) || req.headers["sec-fetch-site"] === "cross-site") return respond(res, 403, "Cross-origin MCP requests are not allowed");
      if (req.url !== "/mcp") return respond(res, 404, "Not found; use /mcp without URL credentials or query parameters");
      const authorization = req.headers.authorization;
      const supplied = Buffer.from(typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
      if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="gridmind-project-memory"');
        return respond(res, 401, "A valid project bearer token is required");
      }
      if (closing) return respond(res, 503, "Gridmind is stopping");
      if (!["POST", "GET", "DELETE"].includes(req.method || "")) {
        res.setHeader("Allow", "POST, GET, DELETE");
        return respond(res, 405, "Method not allowed");
      }
      const id = req.headers["mcp-session-id"];
      if (Array.isArray(id)) return respond(res, 400, "Invalid session ID");
      let entry = id ? sessions.get(id) : undefined;
      if (id && !entry) return respond(res, 404, "Session not found; initialize a new MCP connection");
      let parsed: unknown;
      if (req.method === "POST") {
        const contentType = req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
        if (contentType !== "application/json") return respond(res, 415, "Use application/json");
        try { parsed = await body(req); }
        catch (error) { return respond(res, error instanceof Error && error.message === "size" ? 413 : 400, "Invalid or oversized JSON request"); }
      }
      if (!entry) {
        if (req.method !== "POST" || !isInitializeRequest(parsed)) return respond(res, 400, "Initialize an MCP session before calling tools");
        if (sessions.size + pending.size >= MAX_SESSIONS) return respond(res, 429, "Too many active MCP sessions; close an existing connection or wait for idle expiry");
        const memory = createProjectMemoryServer({ readOnly, mode: "local-http-project-memory" });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (sessionId) => { pending.delete(created); sessions.set(sessionId, created); },
          onsessionclosed: () => { memory.finish(); },
        });
        const created: Entry = { transport, memory, touched: Date.now(), requests: 0 };
        entry = created;
        pending.add(created);
        // Protocol.connect preserves this callback when wiring its own close hook.
        transport.onclose = () => {
          pending.delete(created);
          if (transport.sessionId) sessions.delete(transport.sessionId);
          memory.finish();
        };
        try { await memory.server.connect(transport); }
        catch { await discard(created); return respond(res, 500, "Could not initialize MCP transport"); }
      }
      entry.touched = Date.now();
      // A parked SSE GET must not prevent idle-session cleanup forever.
      if (req.method === "POST") entry.requests++;
      try { await entry.transport.handleRequest(req, res, parsed); }
      finally {
        if (req.method === "POST") entry.requests--;
        // Invalid initialize requests must not consume a pending slot indefinitely.
        if (!entry.transport.sessionId) await discard(entry);
      }
    } catch {
      // Never echo a request, memory payload, credential, or provider error.
      respond(res, 500, "MCP request could not be completed");
    }
  });
  http.requestTimeout = 15000;
  http.headersTimeout = 10000;
  http.maxHeadersCount = 64;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", () => { http.off("error", reject); resolve(); });
  });
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Could not determine MCP listener address");
  actualPort = address.port;
  const timer = setInterval(() => {
    for (const entry of sessions.values()) if (!entry.requests && entry.touched < Date.now() - SESSION_IDLE_MS) void discard(entry);
  }, 60000);
  timer.unref();
  let closePromise: Promise<void> | undefined;
  function close() {
    return closePromise ??= (async () => {
      closing = true;
      clearInterval(timer);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await Promise.allSettled([...new Set([...sessions.values(), ...pending])].map(discard));
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    })();
  }
  function stop() { void close(); }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { url: `http://127.0.0.1:${actualPort}/mcp`, tokenFile, readOnly, close };
}
