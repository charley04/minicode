import { Transform } from "node:stream";

// Bracketed paste mode escape sequences
// \x1b[200~ marks the start of pasted content
// \x1b[201~ marks the end of pasted content
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

// Placeholder used to replace newlines inside pasted content so that readline
// does not split the paste into multiple "line" events. Null byte (\x00) is
// not a line terminator for readline and will never appear in text pastes.
const NL_PLACEHOLDER = "\x00";

/**
 * A Transform stream that detects bracketed paste sequences from the terminal.
 *
 * During normal typing, data passes through unchanged to readline.
 * When a paste is detected (via \x1b[200~...\x1b[201~ markers), the pasted
 * content is buffered and newlines are replaced with a placeholder so that
 * readline treats the entire paste as a single line.
 *
 * The consumer MUST split on the placeholder (\x00) to restore newlines.
 *
 * Usage:
 *   const pt = new PasteTransform();
 *   stdin.pipe(pt);
 *   const rl = createInterface({ input: pt, ... });
 */
export class PasteTransform extends Transform {
  private inPaste = false;
  private pasteBuffer = "";

  constructor() {
    super();
  }

  _transform(chunk: Buffer, _encoding: string, callback: Function): void {
    const str = chunk.toString();

    if (this.inPaste) {
      this._handlePasteData(str);
      callback();
      return;
    }

    const startIdx = str.indexOf(PASTE_START);
    if (startIdx >= 0) {
      // Forward any data that came before the paste marker
      if (startIdx > 0) {
        this.push(str.slice(0, startIdx));
      }

      const after = str.slice(startIdx + PASTE_START.length);

      // Check if the paste end is in this same chunk
      const endIdx = after.indexOf(PASTE_END);
      if (endIdx >= 0) {
        // Complete paste in one chunk
        const content = this._normalizeNewlines(after.slice(0, endIdx));
        this.push(content);
        const rest = after.slice(endIdx + PASTE_END.length);
        if (rest) {
          this.push(rest);
        }
      } else {
        // Paste extends beyond this chunk — start buffering
        this.inPaste = true;
        this.pasteBuffer = after;
      }

      callback();
      return;
    }

    // Normal non-paste data — pass through
    this.push(str);
    callback();
  }

  _flush(callback: Function): void {
    if (this.inPaste && this.pasteBuffer) {
      // Incomplete paste on close — flush what we have
      this.push(this._normalizeNewlines(this.pasteBuffer));
      this.pasteBuffer = "";
      this.inPaste = false;
    }
    callback();
  }

  private _handlePasteData(data: string): void {
    const endIdx = data.indexOf(PASTE_END);
    if (endIdx >= 0) {
      this.pasteBuffer += data.slice(0, endIdx);
      this.inPaste = false;

      // Emit the entire pasted content as one chunk (newlines replaced)
      this.push(this._normalizeNewlines(this.pasteBuffer));
      this.pasteBuffer = "";

      // Forward any data after the paste end marker
      const rest = data.slice(endIdx + PASTE_END.length);
      if (rest) {
        // Recursively process the remainder (may contain another paste)
        this._transform(Buffer.from(rest), "utf-8", () => {});
      }
    } else {
      this.pasteBuffer += data;
    }
  }

  /**
   * Replace newlines (and CRLF / standalone CR) with the placeholder so that
   * readline treats the entire paste as one line.
   */
  private _normalizeNewlines(text: string): string {
    // Order matters: handle \r\n first to avoid double replacement
    return text.replace(/\r\n/g, NL_PLACEHOLDER).replace(/\r/g, NL_PLACEHOLDER).replace(/\n/g, NL_PLACEHOLDER);
  }

  /** Enable bracketed paste mode on the terminal */
  static enable(): void {
    process.stdout.write("\x1b[?2004h");
  }

  /** Disable bracketed paste mode */
  static disable(): void {
    process.stdout.write("\x1b[?2004l");
  }

  /** Restore newlines from placeholder — call on the readline input */
  static restoreNewlines(text: string): string {
    // Split on placeholder and rejoin with real newlines
    const parts = text.split(NL_PLACEHOLDER);
    // If there are no placeholders, return the original text
    if (parts.length === 1) return text;
    return parts.join("\n");
  }
}