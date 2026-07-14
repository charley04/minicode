import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const execAsync = promisify(exec);

export class Sandbox {
  private enabled: boolean;
  private image: string;
  private containerName: string | null = null;

  constructor(enabled: boolean, image: string = "node:22-slim") {
    this.enabled = enabled;
    this.image = image;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async execute(command: string, workdir: string): Promise<{ stdout: string; stderr: string }> {
    if (!this.enabled) {
      return execAsync(command, {
        cwd: workdir,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
      });
    }

    const containerId = await this.ensureContainer(workdir);
    const escapedCommand = command.replace(/'/g, "'\\''");

    try {
      const { stdout, stderr } = await execAsync(
        `docker exec ${containerId} sh -c '${escapedCommand}'`,
        { timeout: 120000, maxBuffer: 1024 * 1024 * 10 },
      );
      return { stdout, stderr };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string };
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || (err as Error).message,
      };
    }
  }

  private async ensureContainer(workdir: string): Promise<string> {
    if (this.containerName) {
      try {
        await execAsync(`docker inspect ${this.containerName}`, { timeout: 5000 });
        return this.containerName;
      } catch {
        this.containerName = null;
      }
    }

    const absWorkdir = resolve(workdir);
    const name = `minicode_sandbox_${Date.now()}`;

    await execAsync(
      `docker run -d --name ${name} -v "${absWorkdir}:/workspace" -w /workspace ${this.image} tail -f /dev/null`,
      { timeout: 60000 },
    );

    this.containerName = name;
    return name;
  }

  async cleanup(): Promise<void> {
    if (!this.containerName) return;
    try {
      await execAsync(`docker stop ${this.containerName}`, { timeout: 10000 });
      await execAsync(`docker rm ${this.containerName}`, { timeout: 10000 });
    } catch {
      // ignore
    }
    this.containerName = null;
  }

  static async isDockerAvailable(): Promise<boolean> {
    try {
      await execAsync("docker --version", { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
