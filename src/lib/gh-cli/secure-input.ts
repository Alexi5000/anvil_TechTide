import { Command, type Child } from "@tauri-apps/plugin-shell";
import { invoke } from "@/lib/invoke";

export const GH_INPUT_BRIDGE = `
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const reader = readline.createInterface({ input: process.stdin });
const deadline = setTimeout(() => process.exit(1), 35000);
reader.once("line", line => {
  reader.close();
  process.stdin.pause();
  let body;
  try { body = JSON.stringify(JSON.parse(line)); } catch { process.exit(1); }
  const args = JSON.parse(process.argv[1]);
  const child = spawn("gh", [...args, "--input", "-"], { stdio: ["pipe", "pipe", "pipe"], timeout: 30000, env: { ...process.env, GH_DEBUG: "" } });
  let output = "";
  child.stdout.on("data", chunk => {
    output += chunk;
    if (output.length > 1048576) child.kill();
  });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.on("error", () => process.exit(1));
  child.on("close", code => {
    clearTimeout(deadline);
    if (code !== 0 || output.length > 1048576) process.exit(1);
    process.stdout.write(output, () => process.exit(0));
  });
  child.stdin.end(body);
});
`;

export async function execGhJsonInput(args: string[], cwd: string, payload: unknown): Promise<unknown> {
  let child: Child | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  try {
    const input = JSON.stringify(payload);
    if (input.length > 1048576) throw new Error("Payload exceeds limit");
    const shellPath = await invoke<string>("get_shell_path");
    const command = Command.create("node", ["-e", GH_INPUT_BRIDGE, JSON.stringify(args)], { cwd, env: { PATH: shellPath } });
    const output = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      const fail = () => reject(new Error("GitHub webhook operation failed"));
      command.stdout.on("data", line => {
        stdout += line;
        if (stdout.length > 1048576) fail();
      });
      command.on("error", fail);
      command.on("close", result => result.code === 0 ? resolve(stdout) : fail());
      timer = setTimeout(fail, 40000);
      command.spawn().then(async spawned => {
        child = spawned;
        if (finished) { await child.kill(); return; }
        await child.write(input + "\n");
      }).catch(fail);
    });
    return output.trim() ? JSON.parse(output) : null;
  } catch {
    throw new Error("GitHub webhook operation failed");
  } finally {
    finished = true;
    clearTimeout(timer);
    await child?.kill().catch(() => {});
  }
}
