import { spawn } from "node:child_process";
import { projectInfo } from "./project.mjs";
import { launcher } from "./setup.mjs";

// Display commands can be pasted into the user's current shell. Execution below
// always passes an argument array and never invokes a shell.
export function shellCommand(parts, platform = process.platform) {
  return (platform === "win32" ? "& " : "") + parts.map((part) => platform === "win32"
    ? `'${String(part).replaceAll("'", "''")}'`
    : `'${String(part).replaceAll("'", "'\\''")}'`).join(" ");
}

export function tunnelPlan(start, { tunnelId, write = false, dryRun = false } = {}) {
  if (typeof tunnelId !== "string" || !/^tunnel_[a-zA-Z0-9_-]{8,100}$/.test(tunnelId)) {
    throw new Error("Provide --tunnel-id from OpenAI Platform tunnel settings (tunnel_...). No tunnel is created automatically.");
  }
  const preview = projectInfo(start);
  if ([process.execPath, launcher, preview.root].some((part) => /\p{Cc}/u.test(part))) {
    throw new Error("Tunnel command paths cannot contain control characters such as tabs or newlines. Use a project and installation path without those characters.");
  }
  const info = dryRun ? preview : projectInfo(preview.root, true);
  // tunnel-client parses a quoted executable command itself, without a shell.
  // Its command parser supports double-quoted arguments on all platforms.
  const command = [process.execPath, launcher, "mcp", "--project", info.root, "--shared-only", ...(!write ? ["--read-only"] : [])]
    .map((part) => JSON.stringify(part)).join(" ");
  const args = ["run", "--control-plane.tunnel-id", tunnelId,
    "--control-plane.api-key", "env:CONTROL_PLANE_API_KEY", "--mcp.command", command,
    "--mcp.stdio-send-initialized-notification",
    "--health.listen-addr", "127.0.0.1:0"];
  return { project_root: info.root, project_id: info.id, tunnel_id: tunnelId, read_only: !write,
    shared_only: true, executable: "tunnel-client", args, command: shellCommand(["tunnel-client", ...args]),
    required_environment: ["CONTROL_PLANE_API_KEY"],
    setup_url: "https://platform.openai.com/settings/organization/tunnels",
    next: "Use a runtime key with Tunnels Read + Use and a tunnel linked to your ChatGPT workspace. Keep this foreground process running; in ChatGPT Plugins add a custom MCP server with Connection: Tunnel, select this tunnel, then test gridmind_get_context. One active runtime per tunnel. This plan does not establish a connection." };
}

export async function runTunnel(plan, env = process.env) {
  if (!env.CONTROL_PLANE_API_KEY?.trim()) throw new Error("Set CONTROL_PLANE_API_KEY securely in your environment before starting the tunnel. Do not put its value in a command argument or Gridmind config. Use --dry-run to inspect setup without a key.");
  // Do not accept arbitrary executable or argument overrides from a saved plan.
  if (plan.executable !== "tunnel-client" || !Array.isArray(plan.args)) throw new Error("Invalid tunnel plan");
  const child = spawn("tunnel-client", plan.args, { cwd: plan.project_root, env, stdio: "inherit", shell: false });
  let stopTimer;
  const stop = () => {
    child.kill("SIGTERM");
    stopTimer ??= setTimeout(() => child.kill("SIGKILL"), 3000);
    stopTimer.unref();
  };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", (error) => reject(new Error(error.code === "ENOENT"
        ? "Install OpenAI's supported tunnel-client first, then run tunnel-client help quickstart. Download it from Platform tunnel settings."
        : "Could not start tunnel-client. Check its installation and permissions.")));
      child.once("exit", (code, signal) => code === 0 || signal === "SIGTERM" ? resolve() : reject(new Error(`tunnel-client exited (${code ?? signal}). Check its readiness and account permissions.`)));
    });
  } finally { clearTimeout(stopTimer); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
