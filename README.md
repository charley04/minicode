# MiniCode

A lightweight AI coding agent for the terminal. Reads your opencode config, supports multiple LLM providers, MCP tools, Claude Code skills, and code review.

## Install

```bash
npm install -g minicode-agent
```

Or run directly from source:

```bash
npx minicode-agent
```

## Quick Start

1. Make sure you have an opencode config at `~/.config/opencode/opencode.json` (or `./opencode.json` in your project). MiniCode reads providers and models from the same config as opencode.

2. Run:

```bash
minicode
```

3. Type `/help` for available commands, `/model` to switch models interactively.

## Features

- **Multi-provider**: OpenAI, Anthropic, Google, and any OpenAI-compatible API (DeepSeek, Moonshot, Volcengine, Ollama, etc.)
- **opencode config**: Reads `opencode.json` directly — no separate config needed
- **Interactive model picker**: `/model` opens a searchable, mouse-clickable model selector
- **10 built-in tools**: bash, read, write, edit, multi_edit, diff, glob, grep, listdir, todo
- **MCP support**: Connect MCP servers (stdio/sse/http), auto-register their tools
- **Skills**: Auto-discovers `SKILL.md` files from `~/.claude/skills/` and `~/.config/opencode/skills/`
- **Markdown rendering**: Code blocks with syntax highlighting, tables, lists
- **Token tracking**: Per-turn and session-level usage stats with cost estimation
- **Code review**: Built-in security/correctness/performance review checklist
- **Sandbox mode**: Docker-based isolation for bash command execution
- **Session persistence**: Conversations saved and resumable
- **HTTP/WS API server**: `minicode server` for programmatic access
- **Plugin system**: Built-in plugins (auto-lint, git-status, file-watcher)

## Usage

### Interactive mode

```bash
minicode                          # Start chatting
minicode --auto-approve           # Auto-approve tool calls
minicode --sandbox                # Run bash in Docker sandbox
minicode -r <session-id>          # Resume a session
```

### One-shot mode

```bash
minicode --one-shot "explain this codebase"
minicode --auto-approve --one-shot "fix the bug in src/index.ts"
```

### Slash commands (in interactive mode)

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/model` | Open model picker (mouse + keyboard) |
| `/model <provider/model>` | Switch model directly |
| `/provider` | List all providers from opencode config |
| `/tokens` | Show token usage |
| `/cost` | Estimate session cost |
| `/skills` | List discovered skills |
| `/mcp` | List MCP servers and tools |
| `/tools` | List all available tools |
| `/clear` | Clear conversation |
| `/exit` | Exit (saves session) |

### CLI commands

```bash
minicode provider                           # List all providers/models
minicode provider volcengine-plan/glm-5.2   # Switch model
minicode provider --test                    # Test current model
minicode sessions                           # List saved sessions
minicode skills                             # List discovered skills
minicode config list                        # Show configuration
minicode server --port 3170                 # Start HTTP/WS API server
```

### Configuration

MiniCode reads model/provider config from opencode's `opencode.json`:

```json
{
  "model": "volcengine-plan/ark-code-latest",
  "provider": {
    "volcengine-plan": {
      "npm": "@ai-sdk/openai",
      "options": {
        "apiKey": "your-api-key",
        "baseURL": "https://example.com/api/v3"
      },
      "models": {
        "ark-code-latest": { "name": "ark-code-latest" }
      }
    }
  }
}
```

Config file locations (searched in order):
1. `./opencode.json` (project-level)
2. `~/.config/opencode/opencode.json` (global)

MiniCode's own config (`~/.minicode/config.json`) stores non-model settings:

```json
{
  "autoApprove": false,
  "sandbox": false,
  "sandboxImage": "node:22-slim",
  "maxTurns": 50,
  "maxContextTokens": 200000,
  "mcpServers": [
    {
      "name": "my-server",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@my/mcp-server"]
    }
  ],
  "skillsPaths": [],
  "plugins": [
    { "name": "auto-lint", "enabled": true, "config": {} }
  ]
}
```

## Requirements

- Node.js 18+
- An LLM API key configured in opencode.json

## 打包与分发

将 MiniCode 打包成可分发的 npm tarball，用于内网 / 同事间分享或作为发布到 npm registry 前的验证。

### 构建产物

```bash
npm run build          # 通过 tsc 将 src/ 编译到 dist/
npm pack               # 依据 package.json 的 "files" 白名单生成 tarball
```

产物为项目根目录下的 `minicode-agent-<version>.tgz`（当前 ~117KB）。包内容仅包含 [package.json](package.json) 中 `files` 字段声明的文件：

- `dist/**/*` — 编译后的 JS / 类型声明
- `README.md`
- `package.json`（npm 自动包含）

可用 `npm pack --dry-run` 预览包内文件，确认没有多余或缺失。

### 本地安装分发包

拿到 `.tgz` 后，用户在本机安装：

```bash
npm install -g ./minicode-agent-1.0.0.tgz
minicode --help
```

`package.json` 中的 [`bin`](package.json#L6-L8) 字段会自动把 `minicode` 注册为全局命令。

### 卸载

```bash
npm uninstall -g minicode-agent
```

### 版本更新流程

1. 修改 `package.json` 中的 `version`（或用 `npm version patch|minor|major`）
2. `npm run build`
3. `npm pack`
4. 分发新的 `.tgz`，用户重新 `npm install -g ./minicode-agent-x.y.z.tgz` 即可覆盖

### 可选：发布到 npm registry

若面向公开用户，可跳过 tarball 分发直接发布：

```bash
npm login
npm publish --access public
```

发布后用户直接 `npm install -g minicode-agent`。注意同一个 version 只能发布一次。

## License

MIT