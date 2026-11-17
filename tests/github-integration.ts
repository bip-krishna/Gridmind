import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../src/lib/db";
import { github, isGithubConfigured, listIssues, parseGithubRepo } from "../src/lib/github";
import { connectGithub, disconnectGithub, githubConnectionStatus, githubCredential, githubRepositories, startGithubDeviceFlow, pollGithubDeviceFlow, cancelGithubDeviceFlow } from "../src/lib/github-connection";
import { GET, POST, DELETE } from "../src/app/api/integrations/github/route";
import { GET as repositoryGet } from "../src/app/api/integrations/github/repositories/route";
import { POST as deviceStart } from "../src/app/api/integrations/github/device/route";
import { POST as devicePoll } from "../src/app/api/integrations/github/device/poll/route";

if (!process.env.GRIDMIND_DATA_DIR || !dataDir().includes("gridmind-")) throw new Error("GitHub tests require a disposable GRIDMIND_DATA_DIR");
const secret = "github_pat_fixture_secret_never_send_to_browser";
const realFetch = globalThis.fetch, realNow = Date.now;
const originalToken = process.env.GITHUB_TOKEN, originalClient = process.env.GITHUB_CLIENT_ID;
const response = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const account = { login: "gridmind-fixture", avatar_url: "https://avatars.githubusercontent.com/fixture", html_url: "https://github.com/gridmind-fixture" };
const request = (method = "GET", body?: unknown, headers?: Record<string, string>) => new Request("http://localhost:3000/api/integrations/github", {
  method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
test.beforeEach(() => {
  delete process.env.GITHUB_TOKEN; delete process.env.GITHUB_CLIENT_ID;
  disconnectGithub();
  globalThis.fetch = async () => { throw new Error("Test refused an unexpected network call"); };
});
test.afterEach(() => {
  globalThis.fetch = realFetch; Date.now = realNow;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = originalToken;
  if (originalClient === undefined) delete process.env.GITHUB_CLIENT_ID; else process.env.GITHUB_CLIENT_ID = originalClient;
});

test("validated GitHub connection stores encrypted owner-only credentials and GET omits secrets", async () => {
  let sentAuthorization = "";
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.github.com/user");
    sentAuthorization = (options?.headers as Record<string, string>).Authorization;
    assert.ok(options?.signal);
    return response(account);
  };
  const connected = await POST(request("POST", { token: secret }));
  assert.equal(connected.status, 200);
  assert.equal(sentAuthorization, `Bearer ${secret}`);
  const body = await connected.json();
  assert.equal(body.account.login, account.login);
  assert.equal(body.source, "saved");
  assert.equal(body.connected, true);
  assert.ok(!JSON.stringify(body).includes(secret));
  const location = path.join(dataDir(), "integrations");
  assert.ok(!fs.readFileSync(path.join(location, "github.json"), "utf8").includes(secret));
  assert.equal(fs.statSync(path.join(location, "github.json")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(location, "github.key")).mode & 0o777, 0o600);
  const status = await GET(request());
  assert.ok(!(await status.text()).includes(secret));
  assert.equal(githubCredential(), secret);
  assert.equal(isGithubConfigured(), true);
  const before = github();
  await DELETE(request("DELETE"));
  assert.equal(isGithubConfigured(), false);
  assert.equal(github(), null);
  globalThis.fetch = async () => response(account);
  await connectGithub(`${secret}_new`);
  assert.notEqual(github(), before);
});

test("invalid credentials and provider failures never echo token content", async () => {
  globalThis.fetch = async () => response({ message: `bad credential ${secret}` }, 401);
  const result = await POST(request("POST", { token: secret }));
  assert.equal(result.status, 401);
  assert.ok(!(await result.text()).includes(secret));
  assert.equal(githubConnectionStatus().connected, false);
  globalThis.fetch = async () => { throw new Error(`transport failed with ${secret}`); };
  const failed = await POST(request("POST", { token: secret }));
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes(secret));
  assert.equal((await POST(request("POST", { token: "" }))).status, 400);
});

test("cross-origin and nonlocal settings requests are rejected before network or disk mutation", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(account); };
  assert.equal((await POST(request("POST", { token: secret }, { Origin: "https://attacker.example" }))).status, 403);
  assert.equal((await DELETE(request("DELETE", undefined, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  const remote = new Request("http://attacker.example/api/integrations/github");
  assert.equal((await GET(remote)).status, 403);
  assert.equal((await GET(request("GET", undefined, { Host: "attacker.example:3000" }))).status, 403);
  assert.equal(calls, 0);
  assert.equal((await POST(request("POST", { token: secret }, { Origin: "http://localhost:3000" }))).status, 200);
  const normalized = request("POST", { token: secret }, { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" });
  assert.equal((await POST(normalized)).status, 200);
  assert.equal((await POST(request("POST", { token: secret }, { Host: "localhost:3000", Origin: "http://127.0.0.1:3000" }))).status, 403);
});

test("environment credential remains available after disconnecting a saved connection", async () => {
  process.env.GITHUB_TOKEN = "ghp_environment_fixture_secret_value";
  assert.equal(githubConnectionStatus().source, "environment");
  assert.equal(githubConnectionStatus().environmentManaged, true);
  globalThis.fetch = async () => response(account);
  await connectGithub(secret);
  assert.equal(githubCredential(), secret);
  const disconnected = disconnectGithub();
  assert.equal(disconnected.source, "environment");
  assert.equal(disconnected.connected, true);
  assert.equal(githubCredential(), process.env.GITHUB_TOKEN);
});

test("repository list is bounded, cached, sanitized and filterable", async () => {
  globalThis.fetch = async () => response(account);
  await connectGithub(secret);
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /\/user\/repos\?per_page=100/);
    return response([
      { full_name: "gridmind-fixture/alpha", private: true, description: "Alpha memory project", default_branch: "develop", html_url: "https://attacker.example" },
      { full_name: "gridmind-fixture/beta", description: null, default_branch: "main" },
      { full_name: "../../bad", description: secret },
    ], 200, { link: '<https://api.github.com/user/repos?page=2>; rel="next"' });
  };
  const result = await githubRepositories("alpha");
  assert.equal(result.repositories.length, 1);
  assert.equal(result.repositories[0].url, "https://github.com/gridmind-fixture/alpha");
  assert.equal(result.repositories[0].defaultBranch, "develop");
  assert.equal(result.truncated, true);
  assert.equal((await githubRepositories("beta")).repositories.length, 1);
  assert.equal(calls, 1);
  const output = await repositoryGet(new Request("http://localhost/api/integrations/github/repositories?q=alpha"));
  assert.equal(output.status, 200);
  assert.ok(!(await output.text()).includes(secret));
});

test("device flow requires a registered app and keeps the device credential server-side", async () => {
  const unavailable = await deviceStart(request("POST"));
  assert.equal(unavailable.status, 503);
  process.env.GITHUB_CLIENT_ID = "fixture-client-id";
  globalThis.fetch = async () => response({ device_code: "server-only-device-secret", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
  const started = await deviceStart(request("POST"));
  assert.equal(started.status, 200);
  const body = await started.json();
  assert.equal(body.userCode, "ABCD-EFGH");
  assert.equal(body.interval, 5);
  assert.ok(!JSON.stringify(body).includes("server-only-device-secret"));
  assert.match(started.headers.get("set-cookie") || "", /HttpOnly/);
  const denied = await devicePoll(request("POST", { flowId: body.flowId }));
  assert.equal(denied.status, 403);
  cancelGithubDeviceFlow(body.flowId);
});

test("device polling handles pending, slowdown and successful account validation without leaking tokens", async () => {
  process.env.GITHUB_CLIENT_ID = "fixture-client-id";
  let now = 100000; Date.now = () => now;
  let phase = "start", calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    if (String(url).endsWith("/device/code")) return response({ device_code: "server-device-secret", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    if (String(url).endsWith("/user")) return response(account);
    if (phase === "pending") return response({ error: "authorization_pending" });
    if (phase === "slow") return response({ error: "slow_down", interval: 10 });
    return response({ access_token: secret });
  };
  const flow = await startGithubDeviceFlow();
  assert.equal((await pollGithubDeviceFlow(flow.flowId, flow.flowId)).status, "pending");
  assert.equal(calls, 1, "early polls never contact GitHub");
  now += 5000; phase = "pending";
  assert.equal((await pollGithubDeviceFlow(flow.flowId, flow.flowId)).status, "pending");
  now += 5000; phase = "slow";
  const slowed = await pollGithubDeviceFlow(flow.flowId, flow.flowId);
  assert.equal(slowed.status, "slow_down");
  assert.equal(slowed.interval, 10);
  now += 10000; phase = "connected";
  const connected = await pollGithubDeviceFlow(flow.flowId, flow.flowId);
  assert.equal(connected.status, "connected");
  assert.ok(!JSON.stringify(connected).includes(secret));
  assert.equal(githubCredential(), secret);
});

test("device cancellation, provider rejection and expiration terminate sign-in safely", async () => {
  process.env.GITHUB_CLIENT_ID = "fixture-client-id";
  let now = 100000; Date.now = () => now;
  globalThis.fetch = async () => response({ device_code: "device-secret", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 10, interval: 5 });
  const cancelled = await startGithubDeviceFlow();
  cancelGithubDeviceFlow(cancelled.flowId);
  await assert.rejects(() => pollGithubDeviceFlow(cancelled.flowId, cancelled.flowId), /expired/);
  const expired = await startGithubDeviceFlow();
  now += 11000;
  await assert.rejects(() => pollGithubDeviceFlow(expired.flowId, expired.flowId), /expired/);
  const rejected = await startGithubDeviceFlow();
  now += 5000;
  globalThis.fetch = async () => response({ error: "access_denied", error_description: secret });
  await assert.rejects(() => pollGithubDeviceFlow(rejected.flowId, rejected.flowId), /cancelled/);
  assert.equal(githubConnectionStatus().connected, false);
});

test("disconnect while device account validation is in flight cannot silently reconnect", async () => {
  process.env.GITHUB_CLIENT_ID = "fixture-client-id";
  let now = 100000; Date.now = () => now;
  let releaseUser!: (value: Response) => void;
  let validatingUser!: () => void;
  const validationStarted = new Promise<void>((resolve) => { validatingUser = resolve; });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/device/code")) return response({ device_code: "device-secret", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    if (String(url).endsWith("/user")) {
      validatingUser();
      return new Promise<Response>((resolve) => { releaseUser = resolve; });
    }
    return response({ access_token: secret });
  };
  const flow = await startGithubDeviceFlow();
  now += 5000;
  const pending = pollGithubDeviceFlow(flow.flowId, flow.flowId);
  await validationStarted;
  disconnectGithub();
  releaseUser(response(account));
  await assert.rejects(() => pending, /cancelled or expired/);
  assert.equal(githubCredential(), null);
  assert.equal(githubConnectionStatus().connected, false);
});

test("repository parsing rejects unrelated hosts and malformed paths, and issue lists exclude pull requests", async () => {
  assert.deepEqual(parseGithubRepo("https://github.com/owner/repo.git"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRepo("git@github.com:owner/repo.git"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRepo("ssh://git@github.com/owner/repo.git"), { owner: "owner", repo: "repo" });
  for (const value of ["owner/repo/tree/main", "https://attacker.example/owner/repo", "https://github.com/owner/repo?secret=1", "owner/..", "../repo"]) assert.equal(parseGithubRepo(value), null);
  const fixture = { issues: { listForRepo: async () => ({ data: [
    { number: 1, title: "Issue", state: "open", html_url: "https://github.com/o/r/issues/1", labels: [] },
    { number: 2, title: "Pull request", pull_request: {}, state: "open", labels: [] },
  ] }) } } as unknown as NonNullable<ReturnType<typeof github>>;
  assert.equal((await listIssues(fixture, { owner: "o", repo: "r" })).length, 1);
});
