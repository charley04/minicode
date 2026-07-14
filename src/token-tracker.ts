import type { TokenUsage, SessionUsage } from "./types.js";

export class TokenTracker {
  private session: SessionUsage = {
    total: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    turns: 0,
    byTurn: [],
  };

  addUsage(usage: TokenUsage): void {
    this.session.total.promptTokens += usage.promptTokens;
    this.session.total.completionTokens += usage.completionTokens;
    this.session.total.totalTokens += usage.totalTokens;
    this.session.turns++;
    this.session.byTurn.push(usage);
  }

  getSessionUsage(): SessionUsage {
    return { ...this.session };
  }

  getLastTurn(): TokenUsage | null {
    if (this.session.byTurn.length === 0) return null;
    return this.session.byTurn[this.session.byTurn.length - 1];
  }

  formatUsage(usage: TokenUsage): string {
    return `${usage.promptTokens}p + ${usage.completionTokens}c = ${usage.totalTokens}t`;
  }

  formatSession(): string {
    const u = this.session.total;
    return `Session: ${u.promptTokens}p + ${u.completionTokens}c = ${u.totalTokens}t (${this.session.turns} turns)`;
  }

  estimateCost(usage: TokenUsage, inputPricePer1M: number, outputPricePer1M: number): number {
    return (
      (usage.promptTokens / 1_000_000) * inputPricePer1M +
      (usage.completionTokens / 1_000_000) * outputPricePer1M
    );
  }

  reset(): void {
    this.session = {
      total: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      turns: 0,
      byTurn: [],
    };
  }
}

export function createTokenTracker(): TokenTracker {
  return new TokenTracker();
}
