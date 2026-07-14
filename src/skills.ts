import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SkillConfig } from "./types.js";

export class SkillManager {
  private skills: SkillConfig[] = [];
  private searchPaths: string[];

  constructor(customPaths: string[] = []) {
    this.searchPaths = [
      ...customPaths,
      join(homedir(), ".claude", "skills"),
      join(homedir(), ".config", "opencode", "skills"),
      join(process.cwd(), ".claude", "skills"),
      join(process.cwd(), ".minicode", "skills"),
    ];
  }

  discover(): SkillConfig[] {
    this.skills = [];
    const seen = new Set<string>();

    for (const basePath of this.searchPaths) {
      if (!existsSync(basePath)) continue;
      this.scanDir(basePath, seen);
    }

    return this.skills;
  }

  private scanDir(dir: string, seen: Set<string>): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const skillFile = join(fullPath, "SKILL.md");
        if (existsSync(skillFile)) {
          const resolved = fullPath;
          if (!seen.has(resolved)) {
            seen.add(resolved);
            const skill = this.parseSkillFile(skillFile);
            if (skill) this.skills.push(skill);
          }
        } else {
          this.scanDir(fullPath, seen);
        }
      }
    }
  }

  private parseSkillFile(filePath: string): SkillConfig | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      const name = filePath.split(/[/\\]/).slice(-2, -1)[0] || "unknown";

      const descMatch = content.match(/^#\s+Skill:\s*(.+)$/im);
      const description = descMatch
        ? descMatch[1].trim()
        : content.slice(0, 100).replace(/\n/g, " ").trim();

      return {
        name,
        description,
        instructions: content,
        path: filePath,
      };
    } catch {
      return null;
    }
  }

  match(input: string): SkillConfig[] {
    const lower = input.toLowerCase();
    return this.skills.filter((skill) => {
      const nameMatch = lower.includes(skill.name.toLowerCase());
      const descMatch = skill.description.toLowerCase().split(/\s+/).some((word) =>
        word.length > 3 && lower.includes(word.toLowerCase()),
      );
      return nameMatch || descMatch;
    });
  }

  getSkill(name: string): SkillConfig | undefined {
    return this.skills.find((s) => s.name === name);
  }

  getAll(): SkillConfig[] {
    return this.skills;
  }

  formatSkillsList(): string {
    if (this.skills.length === 0) return "No skills found.";
    return this.skills
      .map((s) => `  ${s.name.padEnd(30)} ${s.description.slice(0, 60)}`)
      .join("\n");
  }

  buildSkillContext(input: string): string {
    const matched = this.match(input);
    if (matched.length === 0) return "";

    const sections = matched.map(
      (s) => `### Skill: ${s.name}\n\n${s.instructions}`,
    );

    return `\n\n## Active Skills\n\nThe following skills are relevant to the user's request. Follow their instructions:\n\n${sections.join("\n\n")}`;
  }
}
