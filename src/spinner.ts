import { stdout } from "node:process";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message: string;
  private active = false;

  constructor(message: string = "Thinking") {
    this.message = message;
  }

  start(message?: string): void {
    if (message) this.message = message;
    if (this.active) return;
    this.active = true;
    this.frameIndex = 0;

    stdout.write("\x1b[?25l");

    this.interval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
      stdout.write(`\r${frame} ${this.message}`);
      this.frameIndex++;
    }, 80);
  }

  stop(clearLine: boolean = true): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (clearLine) {
      stdout.write("\r\x1b[2K");
    }
    stdout.write("\x1b[?25h");
    this.active = false;
  }

  update(message: string): void {
    this.message = message;
  }

  succeed(message?: string): void {
    this.stop();
    if (message) {
      stdout.write(`\r\x1b[2K`);
      console.log(message);
    }
  }

  fail(message?: string): void {
    this.stop();
    if (message) {
      stdout.write(`\r\x1b[2K`);
      console.log(message);
    }
  }
}
