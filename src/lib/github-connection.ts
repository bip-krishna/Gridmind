import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { dataDir } from "./db";

export type GithubAccount = { login: string; avatarUrl: string; profileUrl: string };
export type GithubConnectionStatus = {
  connected: boolean;
  source: "saved" | "environment" | null;
  account: GithubAccount | null;
  deviceFlowAvailable: boolean;
  environmentManaged: boolean;
  error?: string;
};
type SavedConnection = { version: 1; token: string; account: GithubAccount; expiresAt?: number };
type Envelope = { version: 1; iv: string; tag: string; ciphertext: string };
export type GithubRepository = { fullName: string; description: string; private: boolean; defaultBranch: string; url: string };
const API = "https://api.github.com";
const aad = Buffer.from("gridmind-github-connection-v1");
const globalState = globalThis as unknown as {
  __gridmindGithubDeviceFlows?: Map<string, DeviceFlow>;
  __gridmindGithubRepositories?: { token: string; until: number; repositories: GithubRepository[]; truncated: boolean };
};

export class GithubConnectionError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "GithubConnectionError"; }
}

function directory() {
  const base = dataDir();
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new GithubConnectionError("GitHub connection storage must not be a symlink", 500);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const location = path.join(base, "integrations");
  if (fs.existsSync(location) && fs.lstatSync(location).isSymbolicLink()) throw new GithubConnectionError("GitHub connection storage must not be a symlink", 500);
  fs.mkdirSync(location, { recursive: true, mode: 0o700 });
  return location;
}
function readSafe(file: string): Buffer {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 20000) throw new Error("Invalid credential file");
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}
function atomicWrite(file: string, value: string | Buffer) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function encryptionKey(location: string, create = false): Buffer {
  const file = path.join(location, "github.key");
  if (!fs.existsSync(file) && create) {
    try { fs.writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
  }
  const key = readSafe(file);
  if (key.length !== 32) throw new Error("Invalid credential key");
  return key;
}
function readSaved(): SavedConnection | null {
  const file = path.join(dataDir(), "integrations", "github.json");
  if (!fs.existsSync(file)) return null;
  const location = directory();
  const envelope = JSON.parse(readSafe(file).toString("utf8")) as Envelope;
  if (envelope.version !== 1) throw new Error("Invalid credential version");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(location), Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")) as SavedConnection;
  if (saved.version !== 1 || typeof saved.token !== "string" || !saved.account?.login) throw new Error("Invalid credential record");
  return saved;
}
function save(saved: SavedConnection) {
  const location = directory();
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(location, true), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(saved), "utf8"), cipher.final()]);
  atomicWrite(path.join(location, "github.json"), JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }));
  delete globalState.__gridmindGithubRepositories;
}
export function githubCredential(): string | null {
  try {
    const saved = readSaved();
    if (saved) return !saved.expiresAt || saved.expiresAt > Date.now() ? saved.token : null;
  } catch { return null; }
  return process.env.GITHUB_TOKEN?.trim() || null;
}
export function githubConnectionStatus(): GithubConnectionStatus {
  const base = { deviceFlowAvailable: !!process.env.GITHUB_CLIENT_ID?.trim(), environmentManaged: !!process.env.GITHUB_TOKEN?.trim() };
  try {
    const saved = readSaved();
    if (saved) {
      const expired = !!saved.expiresAt && saved.expiresAt <= Date.now();
      return { ...base, connected: !expired, source: "saved", account: saved.account,
        ...(expired ? { error: "Your GitHub connection expired. Connect again to continue." } : {}) };
    }
  } catch {
    return { ...base, connected: false, source: "saved", account: null, error: "Saved GitHub connection could not be read. Disconnect it and connect again." };
  }
  return { ...base, connected: base.environmentManaged, source: base.environmentManaged ? "environment" : null, account: null };
}
export function disconnectGithub(): GithubConnectionStatus {
  flows().clear();
  const file = path.join(directory(), "github.json");
  if (fs.existsSync(file)) fs.unlinkSync(file);
  delete globalState.__gridmindGithubRepositories;
  return githubConnectionStatus();
}

/** Reject cross-site browser requests and DNS-rebinding hosts for the local settings API. */
export function assertLocalGithubRequest(req: Request) {
  const url = new URL(req.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new GithubConnectionError("GitHub settings are available only on the local Gridmind server", 403);
  const host = req.headers.get("host");
  let expectedOrigin = url.origin;
  if (host) {
    let publicUrl: URL | null = null;
    try { publicUrl = new URL(`${url.protocol}//${host}`); } catch { /* rejected below */ }
    if (!publicUrl || publicUrl.host !== host.toLowerCase() || !["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname)) throw new GithubConnectionError("GitHub settings are available only on the local Gridmind server", 403);
    // Next may normalize req.url to localhost even when the browser used 127.0.0.1.
    // Compare Origin to the validated HTTP authority, never untrusted forwarded headers.
    expectedOrigin = publicUrl.origin;
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== expectedOrigin) throw new GithubConnectionError("Cross-origin GitHub settings requests are not allowed", 403);
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new GithubConnectionError("Cross-site GitHub settings requests are not allowed", 403);
}
export function safeGithubError(error: unknown): { error: string; status: number } {
  if (error instanceof GithubConnectionError) return { error: error.message, status: error.status };
  return { error: "GitHub connection could not be completed. Please try again.", status: 502 };
}
async function api(pathname: string, token: string): Promise<{ data: unknown; response: Response }> {
  let response: Response;
  try {
    response = await fetch(`${API}${pathname}`, { headers: {
      Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10",
    }, signal: AbortSignal.timeout(10000), cache: "no-store" });
  } catch { throw new GithubConnectionError("Could not reach GitHub. Check your connection and try again.", 502); }
  if (!response.ok) {
    if (response.status === 401) throw new GithubConnectionError("GitHub rejected this credential. Connect again with a valid token.", 401);
    if (response.status === 403 || response.status === 429) throw new GithubConnectionError("GitHub denied access or its rate limit was reached. Check token permissions and try again later.", 403);
    throw new GithubConnectionError("GitHub could not complete the request. Please try again later.", 502);
  }
  try { return { data: await response.json(), response }; }
  catch { throw new GithubConnectionError("GitHub returned an unexpected response. Please try again.", 502); }
}
export async function connectGithub(rawToken: unknown, expiresAt?: number, stillValid?: () => boolean): Promise<GithubConnectionStatus> {
  if (typeof rawToken !== "string" || rawToken.trim().length < 20 || rawToken.length > 2048 || /\s/.test(rawToken.trim())) {
    throw new GithubConnectionError("Enter a valid GitHub personal access token.");
  }
  const token = rawToken.trim();
  const { data } = await api("/user", token);
  const user = data as { login?: unknown; avatar_url?: unknown; html_url?: unknown };
  if (!user || typeof user.login !== "string" || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(user.login)) throw new GithubConnectionError("GitHub could not verify the account for this token.", 502);
  const account = { login: user.login, avatarUrl: `https://github.com/${encodeURIComponent(user.login)}.png`, profileUrl: `https://github.com/${encodeURIComponent(user.login)}` };
  if (stillValid && !stillValid()) throw new GithubConnectionError("This GitHub sign-in attempt was cancelled or expired. Start again.", 410);
  save({ version: 1, token, account, expiresAt });
  return githubConnectionStatus();
}
export async function githubRepositories(query = "") {
  const token = githubCredential();
  if (!token) throw new GithubConnectionError("Connect GitHub before choosing a repository.", 401);
  let cached = globalState.__gridmindGithubRepositories;
  if (!cached || cached.token !== token || cached.until <= Date.now()) {
    const { data, response } = await api("/user/repos?per_page=100&sort=updated&direction=desc", token);
    if (!Array.isArray(data)) throw new GithubConnectionError("GitHub returned an unexpected repository list.", 502);
    const repositories: GithubRepository[] = data.flatMap((row) => {
      if (!row || typeof row.full_name !== "string" || !/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(row.full_name)) return [];
      return [{ fullName: row.full_name, description: typeof row.description === "string" ? row.description : "", private: row.private === true,
        defaultBranch: typeof row.default_branch === "string" ? row.default_branch : "main", url: `https://github.com/${row.full_name}` }];
    });
    cached = { token, until: Date.now() + 30000, repositories, truncated: /rel="next"/.test(response.headers.get("link") || "") };
    globalState.__gridmindGithubRepositories = cached;
  }
  const filter = query.trim().toLowerCase().slice(0, 100);
  return { repositories: cached.repositories.filter((repo) => !filter || `${repo.fullName} ${repo.description}`.toLowerCase().includes(filter)), truncated: cached.truncated };
}

type DeviceFlow = { id: string; deviceCode: string; clientId: string; expiresAt: number; interval: number; nextPoll: number };
function flows() { return globalState.__gridmindGithubDeviceFlows ??= new Map(); }
export const githubFlowCookie = "gridmind_github_flow";
export function cancelGithubDeviceFlow(id?: string) { if (id) flows().delete(id); }
async function deviceRequest(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), cache: "no-store" });
  } catch { throw new GithubConnectionError("Could not reach GitHub authorization. Please try again.", 502); }
  if (!response.ok) throw new GithubConnectionError("GitHub authorization is currently unavailable. Please try again.", 502);
  try { return await response.json() as Record<string, unknown>; }
  catch { throw new GithubConnectionError("GitHub authorization returned an unexpected response.", 502); }
}
export async function startGithubDeviceFlow(previousId?: string) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId) throw new GithubConnectionError("Browser sign-in requires GITHUB_CLIENT_ID from a registered GitHub app with device flow enabled. You can connect with a personal access token instead.", 503);
  cancelGithubDeviceFlow(previousId);
  for (const [id, flow] of flows()) if (flow.expiresAt <= Date.now()) flows().delete(id);
  if (flows().size >= 20) throw new GithubConnectionError("Too many sign-in attempts are pending. Cancel one or wait for it to expire.", 429);
  const data = await deviceRequest("https://github.com/login/device/code", { client_id: clientId, scope: "repo read:user" });
  if (data.error) throw new GithubConnectionError("GitHub device sign-in is not enabled for this app. Check its registered client ID and device-flow setting.", 400);
  if (typeof data.device_code !== "string" || typeof data.user_code !== "string" || data.verification_uri !== "https://github.com/login/device"
    || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new GithubConnectionError("GitHub authorization returned an unexpected response.", 502);
  }
  const interval = Math.max(5, typeof data.interval === "number" && Number.isFinite(data.interval) ? Math.ceil(data.interval) : 5);
  const expiresAt = Date.now() + Math.min(data.expires_in, 900) * 1000;
  const id = randomBytes(24).toString("hex");
  flows().set(id, { id, clientId, deviceCode: data.device_code, expiresAt, interval, nextPoll: Date.now() + interval * 1000 });
  return { flowId: id, userCode: data.user_code, verificationUri: "https://github.com/login/device", expiresAt, interval };
}
function cookieFlowId(req: Request): string | undefined {
  return req.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${githubFlowCookie}=`))?.slice(githubFlowCookie.length + 1);
}
export function requestGithubFlowId(req: Request) { return cookieFlowId(req); }
export async function pollGithubDeviceFlow(id: unknown, cookie: string | undefined) {
  if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id) || !cookie || !/^[a-f0-9]{48}$/.test(cookie) || !timingSafeEqual(Buffer.from(id), Buffer.from(cookie))) throw new GithubConnectionError("This GitHub sign-in attempt does not belong to this browser. Start again.", 403);
  const flow = flows().get(id);
  if (!flow || flow.expiresAt <= Date.now()) {
    flows().delete(id);
    throw new GithubConnectionError("This GitHub sign-in attempt expired. Start again.", 410);
  }
  if (flow.nextPoll > Date.now()) return { status: "pending" as const, interval: Math.max(1, Math.ceil((flow.nextPoll - Date.now()) / 1000)) };
  flow.nextPoll = Date.now() + flow.interval * 1000;
  const data = await deviceRequest("https://github.com/login/oauth/access_token", { client_id: flow.clientId,
    device_code: flow.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  const stillValid = () => flows().get(id) === flow && flow.expiresAt > Date.now();
  if (!stillValid()) throw new GithubConnectionError("This GitHub sign-in attempt was cancelled or expired. Start again.", 410);
  if (data.error === "authorization_pending") return { status: "pending" as const, interval: flow.interval };
  if (data.error === "slow_down") {
    flow.interval = Math.max(flow.interval + 5, typeof data.interval === "number" && Number.isFinite(data.interval) ? Math.ceil(data.interval) : 0);
    flow.nextPoll = Date.now() + flow.interval * 1000;
    return { status: "slow_down" as const, interval: flow.interval };
  }
  if (data.error) {
    flows().delete(id);
    if (data.error === "access_denied") throw new GithubConnectionError("GitHub sign-in was cancelled. You can try again.", 403);
    if (data.error === "expired_token" || data.error === "token_expired") throw new GithubConnectionError("This GitHub sign-in attempt expired. Start again.", 410);
    throw new GithubConnectionError("GitHub could not authorize this sign-in. Check the app configuration and start again.", 400);
  }
  if (data.expires_in !== undefined && (typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0)) {
    flows().delete(id);
    throw new GithubConnectionError("GitHub authorization returned an invalid token expiration. Start again.", 502);
  }
  const expiresAt = typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined;
  const connection = await connectGithub(data.access_token, expiresAt, stillValid);
  flows().delete(id);
  return { status: "connected" as const, ...connection };
}
