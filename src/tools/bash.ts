import type { Tool } from "../types.js";
import { spawn, execFile } from "node:child_process";
import { resolve } from "node:path";
import type { Sandbox } from "../sandbox.js";

let sandboxInstance: Sandbox | null = null;

export function setSandbox(sandbox: Sandbox | null): void {
  sandboxInstance = sandbox;
}

const isWindows = process.platform === "win32";

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (isWindows) {
    // taskkill /T = kill descendants, /F = force
    try {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => { /* ignore */ });
    } catch { /* ignore */ }
  } else {
    // Kill the whole process group (spawn uses detached:false by default so pgid == pid
    // is not guaranteed; try both).
    try { process.kill(-pid, "SIGTERM"); } catch { /* ignore */ }
    try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
    setTimeout(() => {
      try { process.kill(-pid, "SIGKILL"); } catch { /* ignore */ }
      try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
    }, 2000).unref();
  }
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
}

function runShell(
  command: string,
  workdir: string,
  timeout: number,
  signal: AbortSignal | undefined,
): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    const shell = isWindows ? "cmd.exe" : "/bin/bash";
    const shellArg = isWindows ? "/c" : "-c";
    const child = spawn(shell, [shellArg, command], {
      cwd: workdir,
      env: {
        ...process.env,
        ...(isWindows ? { LANG: "en_US.UTF-8", PYTHONIOENCODING: "utf-8" } : {}),
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const MAX = 1024 * 1024 * 10;

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (d) => {
      if (stdout.length < MAX) stdout += d;
    });
    child.stderr?.on("data", (d) => {
      if (stderr.length < MAX) stderr += d;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeout);

    const onAbort = () => {
      aborted = true;
      killTree(child.pid);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      stderr += `\n${(err as Error).message}`;
      resolvePromise({ stdout, stderr, exitCode: 1, timedOut, aborted });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolvePromise({ stdout, stderr, exitCode: code ?? 0, timedOut, aborted });
    });
  });
}

export const bashTool: Tool = {
  name: "bash",
  description:
    "Executes a shell command and returns stdout + stderr. On Windows runs in cmd.exe, on Linux/macOS in /bin/bash. 120-second timeout by default; cancellable via user interrupt (ESC / Ctrl+C). The exit code is always reported at the end. NOTE: On Windows, avoid Unix-only commands — use 'type' instead of 'cat', 'findstr' instead of 'grep', 'dir' instead of 'ls'. Use 'powershell -Command \"...\"' for PowerShell commands.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute.",
      },
      workdir: {
        type: "string",
        description: "Working directory. Defaults to current directory.",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds. Defaults to 120000 (120s).",
      },
    },
    required: ["command"],
  },
  requirePermission: true,
  async execute(args, ctx) {
    const command = args.command as string;
    const workdir = resolve((args.workdir as string | undefined) || process.cwd());
    const timeout = (args.timeout as number | undefined) ?? 120000;
    const signal = ctx?.signal;

    if (signal?.aborted) {
      return { output: "Aborted before start.", error: true };
    }

    try {
      if (sandboxInstance && sandboxInstance.isEnabled()) {
        const result = await sandboxInstance.execute(command, workdir);
        let output = "";
        if (result.stdout) output += result.stdout;
        if (result.stderr) output += (output ? "\n" : "") + result.stderr;
        if (!output) output = "(no output)";
        if (output.length > 51200) {
          output = output.slice(0, 51200) + "\n... (output truncated)";
        }
        output += `\n[exit code: 0]`;
        return { output };
      }

      const result = await runShell(command, workdir, timeout, signal);

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? "\n" : "") + result.stderr;
      if (!output) output = result.aborted ? "(aborted)" : result.timedOut ? "(timed out)" : "(no output)";

      if (output.length > 51200) {
        output = output.slice(0, 51200) + "\n... (output truncated)";
      }

      if (result.timedOut) output += `\n[timeout: ${timeout}ms]`;
      if (result.aborted) output += `\n[aborted by user]`;
      output += `\n[exit code: ${result.exitCode}]`;

      const errored = result.exitCode !== 0 || result.timedOut || result.aborted;
      return { output, error: errored };
    } catch (err: unknown) {
      const error = err as { message: string };
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};
