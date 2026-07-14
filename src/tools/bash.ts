import type { Tool } from "../types.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { Sandbox } from "../sandbox.js";

const execAsync = promisify(exec);

let sandboxInstance: Sandbox | null = null;

export function setSandbox(sandbox: Sandbox | null): void {
  sandboxInstance = sandbox;
}

const isWindows = process.platform === "win32";

export const bashTool: Tool = {
  name: "bash",
  description:
    "Executes a shell command and returns stdout + stderr. On Windows runs in cmd.exe, on Linux/macOS in /bin/bash. 120-second timeout. The exit code is always reported at the end. NOTE: On Windows, avoid Unix-only commands — use 'type' instead of 'cat', 'findstr' instead of 'grep', 'dir' instead of 'ls'. Use 'powershell -Command \"...\"' for PowerShell commands.",
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
  async execute(args) {
    const command = args.command as string;
    const workdir = resolve((args.workdir as string | undefined) || process.cwd());
    const timeout = (args.timeout as number | undefined) ?? 120000;

    try {
      let stdout: string;
      let stderr: string;
      let exitCode = 0;

      if (sandboxInstance && sandboxInstance.isEnabled()) {
        const result = await sandboxInstance.execute(command, workdir);
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        try {
          const result = await execAsync(command, {
            cwd: workdir,
            timeout,
            maxBuffer: 1024 * 1024 * 10,
            shell: isWindows ? "cmd.exe" : "/bin/bash",
            encoding: "utf-8",
            env: {
              ...process.env,
              ...(isWindows ? { LANG: "en_US.UTF-8", PYTHONIOENCODING: "utf-8" } : {}),
            },
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (err: unknown) {
          const error = err as { stdout?: string; stderr?: string; code?: number; message: string };
          stdout = error.stdout || "";
          stderr = error.stderr || "";
          exitCode = error.code ?? 1;

          let output = "";
          if (stdout) output += stdout;
          if (stderr) output += (output ? "\n" : "") + stderr;
          if (!output) {
            let msg = error.message.replace(/^Command failed:\s*/, "");
            output = msg;
          }

          if (output.length > 51200) {
            output = output.slice(0, 51200) + "\n... (output truncated)";
          }

          output += `\n[exit code: ${exitCode}]`;
          return { output, error: true };
        }
      }

      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n" : "") + stderr;
      if (!output) output = "(no output)";

      if (output.length > 51200) {
        output = output.slice(0, 51200) + "\n... (output truncated)";
      }

      output += `\n[exit code: ${exitCode}]`;

      return { output };
    } catch (err: unknown) {
      const error = err as { message: string };
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};
