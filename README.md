# MiniCode

A lightweight AI coding agent for the terminal. Reads your opencode config, supports multiple LLM providers, MCP tools, Claude Code skills, and code review.

## Install

### From npm (when published)

```bash
npm install -g minicode-agent
```

### From local tarball

```bash
npm install -g minicode-agent-1.0.0.tgz
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
- **Task progress**: Visual progress bar for multi-step tasks
- **Session persistence**: Conversations saved and resumable
- **HTTP/WS API server**: `minicode server` for programmatic access

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

MiniCode's own config (`~/.minicode/config.json`) stores non-model settings (auto-approve, sandbox, MCP servers, etc.).

## Requirements

- Node.js 18+
- An LLM API key configured in opencode.json

## License

MIT
