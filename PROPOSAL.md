# 自研 Agent 工具方案

## 一、开源 Agent 工具分析

### 1.1 OpenCode (sst/opencode)

**定位**: 开源 AI 编码 Agent，终端 TUI 为主，附带桌面应用。

**架构**:
```
packages/
├── core/       # 核心引擎 (Effect + Drizzle/SQLite)
│   ├── session/        # 会话管理 (V2 Session Core: 持久化 prompt 准入 + 执行分离)
│   ├── system-context/ # 系统上下文代数与注册表
│   ├── storage/        # SQLite 存储 (Bun/Node 双实现)
│   ├── pty/            # 伪终端 (Bun/Node 双实现)
│   ├── filesystem/     # 文件系统抽象 (Bun/Node 双实现)
│   └── database/       # 数据库层
├── tui/        # 终端 UI (Solid.js + OpenTUI)
├── server/     # HTTP API 服务层
├── protocol/   # 协议定义 (Schema → Core → Protocol → Server)
├── schema/     # 数据 Schema
├── sdk/        # JavaScript SDK (Client runtime)
├── plugin/     # 插件系统
├── llm/        # LLM 抽象层
├── codemode/   # 代码模式
├── console/    # Web 控制台
├── web/        # Web 前端
└── client/     # 客户端
```

**技术栈**:
- 语言: TypeScript (Bun 运行时)
- 核心框架: Effect (函数式 effect 系统)
- 数据库: Drizzle ORM + SQLite
- TUI: Solid.js + @opentui/solid
- LLM: Vercel AI SDK (`ai` + `@ai-sdk/*`，20+ Provider)
- MCP: `@modelcontextprotocol/sdk`
- 协议: `@agentclientprotocol/sdk` (ACP)
- 代码解析: tree-sitter (bash/powershell)
- Schema 验证: Zod v4

**核心特性**:
- 双 Agent 模式: `build` (全权限) / `plan` (只读分析)
- Subagent 机制 (`@general` 并行多步搜索)
- Skills 系统 (`SKILL.md` 自动发现)
- 多 Provider 支持 (Anthropic/OpenAI/Google/Bedrock/Azure/Groq/Mistral/Cohere 等 20+)
- 持久化会话 (SQLite，崩溃恢复)
- 权限控制 (文件编辑/Bash 命令审批)
- OpenTelemetry 可观测性

**扩展机制**: 插件 (plugin 包) + MCP 服务器 + Skills (markdown) + 自定义 Provider

---

### 1.2 Claude Code (Anthropic)

**定位**: 闭源终端 Agent，插件生态丰富。

**架构**: 闭源核心引擎 (`claude` 二进制) + 插件层

**技术栈**: Node.js 18+，插件用 TypeScript/JSON

**核心特性**:
- Agentic 工具调用 (文件编辑/bash/git)
- Plan vs Act 模式
- Sub-agents (并行专家 Agent)
- Hooks 事件系统 (PreToolUse/SessionStart/Stop)
- 人机协作审批
- Headless 模式 (CI/CD)
- `CLAUDE.md` 项目上下文

**扩展机制**: Plugins (打包文件夹: commands/agents/skills/hooks/MCP) + Agent Skills (`SKILL.md`) + MCP 服务器 + Hooks (事件驱动 JS/TS)

---

### 1.3 Aider

**定位**: 终端结对编程工具，Git 深度集成。

**架构**: 单进程，编辑格式引擎 + tree-sitter repo map

**技术栈**: Python，`litellm` 多 Provider，tree-sitter

**核心特性**:
- Repo map (代码库感知)
- Git 自动提交
- 编辑后自动 lint/test
- 语音转代码
- 图片/URL 上下文
- Architect/Editor 双模型模式

**扩展机制**: 极简 — 配置文件 + 自定义命令/prompts + litellm Provider。无 MCP 支持。

---

### 1.4 Cline

**定位**: 多端 Agent (CLI / VS Code / JetBrains / Web Kanban / SDK)

**架构**: 共享 Agent 核心 (`@cline/sdk`) + 多端应用

**技术栈**: TypeScript/Node.js

**核心特性**:
- 工具审批门控
- Plan/Act 切换
- `.clinerules` 项目规则
- 多 Agent 团队 (协调者 + 专家)
- 定时 Agent (cron)
- 消息集成 (Slack/Telegram/Discord)
- Checkpoint/Undo

**扩展机制**: SDK 插件 (`createTool()` + `Agent` 类) + MCP + Skills

---

### 1.5 Goose (Block)

**定位**: 通用 Agent (桌面应用 / CLI / API)

**架构**: Agent 循环 + 工具调用，Linux Foundation 托管

**技术栈**: **Rust** (性能/可移植)

**核心特性**:
- 15+ Provider
- ACP (Agent Client Protocol) — 复用已有 Claude/ChatGPT/Gemini 订阅
- 70+ MCP 扩展
- 桌面 UI

**扩展机制**: MCP 为主 + 自定义发行版 (预配置 Provider/扩展/品牌)

---

### 1.6 Crush (Charm)

**定位**: 终端 TUI Agent，workspace 共享模型

**架构**: `crush serve` 后端 + 多 TUI 客户端共享 workspace

**技术栈**: **Go**，Bubble Tea TUI 框架

**核心特性**:
- 多模型会话中切换
- LSP 集成 (代码上下文)
- MCP (stdio/http/sse 三种传输)
- `AGENTS.md` / `CRUSH.md` 全局上下文
- Hooks
- Workspace 共享 (多客户端同会话)
- `--yolo` 自动审批

**扩展机制**: MCP + Agent Skills (`SKILL.md`) + 自定义 Provider (OpenAI/Anthropic 兼容 + 本地自动发现) + Hooks + LSP 上下文源

---

### 1.7 OpenHands (formerly OpenDevin)

**定位**: 自托管 Agent 控制中心 (Agent Canvas)

**架构**: Agent Canvas (前端) + Agent Server (REST API) + Automation Server (工作流)

**技术栈**: Node.js 22+ (前端) + Python/uv (服务端) + Docker (沙箱)

**核心特性**:
- 多后端 (本地/Docker/VM/云)
- 自动化集成 (Slack/GitHub/Linear/Notion)
- ACP 插入任意兼容 Agent
- Webhook + Cron 定时工作流

**扩展机制**: ACP 协议 + Automation Server + 后端抽象

---

### 1.8 Fabric (danielmiessler)

**定位**: Prompt 链式 CLI 框架 (非对话式 Agent)

**架构**: Pattern 引擎 — stdin → Pattern (system prompt) → LLM → stdout

**技术栈**: **Go** (从 Python 迁移)

**核心特性**:
- 100+ 内置 Patterns
- Prompt 策略 (CoT/ToT/AoT/self-refine/reflexion)
- YouTube 转录提取
- 30+ Provider
- 图片生成 + 语音转文字
- REST API + Ollama 兼容模式

**扩展机制**: 自定义 Patterns (markdown `system.md`) + Strategies (JSON) + Extensions + helper apps

---

### 1.9 横向对比矩阵

| 维度 | OpenCode | Claude Code | Aider | Cline | Goose | Crush | OpenHands | Fabric |
|------|----------|-------------|-------|-------|-------|-------|-----------|--------|
| **语言** | TS/Bun | Node.js | Python | TS/Node | Rust | Go | TS+Python | Go |
| **UI 形态** | TUI+桌面 | TUI | TUI | IDE+CLI+Web | 桌面+CLI | TUI | Web | CLI |
| **Agent 模式** | build/plan | plan/act | architect/editor | plan/act | 单一 | 单一 | 多后端 | Pattern链 |
| **MCP 支持** | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Skills** | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ✅(Patterns) |
| **Sub-agent** | ✅ | ✅ | ❌ | ✅(团队) | ❌ | ❌ | ✅(ACP) | ❌ |
| **会话持久化** | ✅ SQLite | ✅ | ✅ Git | ✅ Checkpoint | ✅ | ✅ | ✅ | ✅ |
| **Provider 数** | 20+ | 1(Anthropic) | 100+(litellm) | 多 | 15+ | 多 | 多 | 30+ |
| **插件 SDK** | ✅ | ✅ Hooks | ❌ | ✅ | ❌ | ❌ | ✅ ACP | ❌ |
| **沙箱隔离** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Docker | ❌ |
| **可观测性** | ✅ OTel | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 二、核心架构模式总结

从上述分析中提炼出 **6 个关键架构模式**:

### 模式 1: Agent 核心 / 表面分离
> OpenCode (core/tui/server), Cline (sdk/apps), Crush (serve/client), OpenHands (canvas/server)

核心 Agent 循环与 UI 解耦，同一核心支撑多种交互形态。

### 模式 2: 工具系统 + 审批门控
> 所有工具 Agent 共有

每个工具 (bash/edit/grep) 是一个注册函数，带输入 Schema 和权限提示。

### 模式 3: MCP 作为工具扩展标准
> OpenCode/Claude Code/Cline/Goose/Crush/OpenHands 全部支持

MCP 是事实标准，接入即可获得 70+ 社区服务器。

### 模式 4: Agent Skills (SKILL.md)
> Claude Code/Crush/OpenCode 采用

Markdown 指令文件，从约定路径自动发现，非开发者也可编写。

### 模式 5: Provider 抽象层
> 所有工具共有

配置驱动的 Provider 层 (OpenAI 兼容 / Anthropic 兼容 / 本地自动发现) 是标配。

### 模式 6: 持久化会话
> OpenCode (SQLite), Cline (Checkpoint), Crush (workspace)

会话状态持久化，支持崩溃恢复和历史回溯。

---

## 三、自研 Agent 工具方案

### 3.1 定位与目标

**产品名**: MiniCode

**定位**: 轻量级、可扩展的 AI 编码 Agent，面向开发者的日常编码辅助。

**核心目标**:
1. **轻量**: 核心二进制 < 15MB，冷启动 < 500ms
2. **可扩展**: 插件 + MCP + Skills 三层扩展
3. **多 Provider**: 支持 OpenAI/Anthropic/Google/本地模型
4. **安全**: 工具审批门控 + 沙箱执行选项
5. **可观测**: 内置 token 用量追踪 + 操作日志

**非目标** (MVP 阶段):
- 不做 Web UI (先聚焦 TUI)
- 不做 IDE 插件 (先聚焦 CLI)
- 不做多 Agent 团队 (先做单 Agent + Subagent)

---

### 3.2 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      MiniCode                           │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │   TUI    │  │   CLI    │  │   API    │  │  SDK   │ │
│  │ (Bubble  │  │ (Cobra)  │  │ (HTTP/   │  │ (Go    │ │
│  │  Tea)    │  │          │  │  WS)     │  │  pkg)  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │              │             │      │
│       └──────────────┴──────┬──────┴─────────────┘      │
│                             │                            │
│                    ┌────────▼────────┐                   │
│                    │   Agent Core    │                   │
│                    │                 │                   │
│                    │  ┌───────────┐  │                   │
│                    │  │  Session  │  │  会话管理 + 持久化 │
│                    │  │  Manager  │  │                   │
│                    │  └─────┬─────┘  │                   │
│                    │        │        │                   │
│                    │  ┌─────▼─────┐  │                   │
│                    │  │   Agent   │  │  Agent 循环       │
│                    │  │   Loop    │  │  (plan/act)       │
│                    │  └─────┬─────┘  │                   │
│                    │        │        │                   │
│                    │  ┌─────▼─────┐  │                   │
│                    │  │  Tool     │  │  工具注册 + 审批  │
│                    │  │  Registry │  │                   │
│                    │  └─────┬─────┘  │                   │
│                    │        │        │                   │
│                    │  ┌─────▼─────┐  │                   │
│                    │  │  Context   │  │  上下文构建      │
│                    │  │  Builder   │  │  (system prompt  │
│                    │  └─────┬─────┘  │   + file context) │
│                    └────────┼────────┘                   │
│                             │                            │
│          ┌──────────────────┼──────────────────┐        │
│          │                  │                  │        │
│   ┌──────▼──────┐  ┌───────▼───────┐  ┌──────▼───────┐  │
│   │  Provider   │  │  Persistence  │  │  Extension   │  │
│   │  Layer      │  │  Layer        │  │  Layer       │  │
│   │             │  │               │  │              │  │
│   │ - OpenAI    │  │ - SQLite      │  │ - MCP Client │  │
│   │ - Anthropic │  │ - Session Log │  │ - Skills     │  │
│   │ - Google    │  │ - Config      │  │ - Plugins    │  │
│   │ - Local     │  │   (YAML)      │  │   (Go iface) │  │
│   │ - Custom    │  │               │  │              │  │
│   └─────────────┘  └───────────────┘  └──────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### 3.3 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| **语言** | Go | 单二进制部署、跨平台、并发模型适合 Agent IO 密集场景、Crush/Goose 已验证可行 |
| **TUI** | Bubble Tea (Charm) | 成熟的 Go TUI 框架，Crush 同栈，社区活跃 |
| **CLI** | Cobra | Go 事实标准 CLI 框架 |
| **LLM 交互** | 原生 HTTP + SSE | 避免重依赖，直接对接 Provider API，streaming 用 SSE |
| **数据库** | SQLite (via modernc.org/sqlite) | 纯 Go 实现，无 CGO 依赖，跨平台 |
| **配置** | YAML (viper) | 人类可读，支持多层级覆盖 (全局/项目) |
| **MCP** | `mark3labs/mcp-go` | Go MCP SDK，成熟度较好 |
| **Schema** | Go struct + JSON tags | 原生方案，无需额外依赖 |
| **日志** | slog (标准库) | Go 1.21+ 内置，结构化日志 |
| **测试** | 标准 testing + testify | Go 生态标配 |

**为什么选 Go 而非 TypeScript (OpenCode) 或 Python (Aider)?**

| 维度 | Go | TypeScript/Bun | Python |
|------|-----|---------------|--------|
| 部署 | 单二进制 ✅ | 需 Bun 运行时 | 需 Python 环境 |
| 跨平台 | ✅ 原生交叉编译 | ✅ 但需运行时 | ⚠️ 依赖管理复杂 |
| 性能 | ✅ 编译型 | ⚠️ JIT | ❌ 解释型 |
| 并发 | goroutine 天然适合 | Promise/async | asyncio 较繁琐 |
| 生态 (AI) | ⚠️ 较弱 | ✅ Vercel AI SDK | ✅ 最丰富 |
| TUI | ✅ Bubble Tea | ✅ OpenTUI | ⚠️ Textual |
| MCP SDK | ✅ mcp-go | ✅ 官方 SDK | ✅ 官方 SDK |

> Go 的部署优势 (单二进制) 和并发模型是选择的主因。AI 生态较弱通过自建 Provider 抽象层弥补。

---

### 3.4 核心模块设计

#### 3.4.1 Agent Loop (Agent 循环)

```go
// Agent 循环核心逻辑
type AgentLoop struct {
    session     *Session
    provider    Provider
    tools       *ToolRegistry
    context     *ContextBuilder
    permission  PermissionGate
    maxTurns    int
}

func (l *AgentLoop) Run(ctx context.Context, userInput string) (<-chan Event, error) {
    events := make(chan Event, 100)

    go func() {
        defer close(events)

        // 1. 构建上下文 (system prompt + file context + history)
        messages := l.context.Build(l.session, userInput)

        for turn := 0; turn < l.maxTurns; turn++ {
            // 2. 调用 LLM (streaming)
            stream, err := l.provider.Stream(ctx, messages, l.tools.Schemas())
            if err != nil {
                events <- ErrorEvent{err}
                return
            }

            // 3. 处理流式响应
            result := l.consumeStream(ctx, stream, events)

            // 4. 如果没有工具调用 → 完成
            if len(result.ToolCalls) == 0 {
                events <- DoneEvent{}
                l.session.AppendAssistant(result.Text)
                return
            }

            // 5. 执行工具调用 (带审批)
            for _, call := range result.ToolCalls {
                events <- ToolCallEvent{call}

                // 权限检查
                if !l.permission.Allow(call) {
                    events <- PermissionRequestEvent{call}
                    // 等待用户审批...
                }

                // 执行工具
                output, err := l.tools.Execute(ctx, call)
                events <- ToolResultEvent{call.ID, output, err}

                // 追加到消息历史
                messages = append(messages, ToolMessage(call.ID, output))
            }

            // 6. 继续下一轮
        }
    }()

    return events, nil
}
```

#### 3.4.2 Tool System (工具系统)

```go
// 工具接口
type Tool interface {
    Name() string
    Description() string
    Schema() jsonschema.Schema       // JSON Schema 描述参数
    Execute(ctx context.Context, args json.RawMessage) (ToolResult, error)
    RequirePermission() PermissionLevel  // None / Ask / Auto
}

// 内置工具
type BashTool struct{ ... }        // 执行 shell 命令
type ReadFileTool struct{ ... }    // 读文件
type WriteFileTool struct{ ... }   // 写文件
type EditFileTool struct{ ... }    // 精确编辑 (search & replace)
type GlobTool struct{ ... }        // 文件模式匹配
type GrepTool struct{ ... }        // 内容搜索
type ListDirTool struct{ ... }     // 列目录
type WebFetchTool struct{ ... }    // 抓取网页
type TodoWriteTool struct{ ... }   // 任务列表

// 工具注册表
type ToolRegistry struct {
    tools map[string]Tool
}

func (r *ToolRegistry) Register(t Tool) { ... }
func (r *ToolRegistry) Execute(ctx context.Context, call ToolCall) (ToolResult, error) { ... }
func (r *ToolRegistry) Schemas() []jsonschema.Schema { ... }  // 传给 LLM
```

#### 3.4.3 Provider Layer (Provider 抽象层)

```go
// Provider 接口
type Provider interface {
    Stream(ctx context.Context, messages []Message, tools []ToolSchema) (Stream, error)
    Models() []ModelInfo
}

type Stream interface {
    Next() (Chunk, bool)    // 文本 delta / 工具调用 delta / 完成
    Err() error
}

// 内置 Provider
type OpenAIProvider struct {
    apiKey  string
    baseURL string  // 支持兼容 API
}
type AnthropicProvider struct {
    apiKey  string
    baseURL string
}
type GoogleProvider struct {
    apiKey string
}
type LocalProvider struct {
    baseURL string  // Ollama / llama.cpp / LM Studio
}

// Provider 工厂
func NewProvider(cfg ProviderConfig) (Provider, error) {
    switch cfg.Type {
    case "openai":
        return &OpenAIProvider{...}, nil
    case "anthropic":
        return &AnthropicProvider{...}, nil
    case "google":
        return &GoogleProvider{...}, nil
    case "local":
        return &LocalProvider{...}, nil
    case "custom":
        // 用户自定义 Provider (OpenAI 兼容)
        return &OpenAIProvider{baseURL: cfg.BaseURL}, nil
    }
}
```

#### 3.4.4 Session & Persistence (会话与持久化)

```go
// 会话
type Session struct {
    ID        string
    Project   string       // 项目路径
    Messages  []Message    // 消息历史
    CreatedAt time.Time
    UpdatedAt time.Time
    Model     string       // 当前模型
    Mode      AgentMode    // plan / act
}

// 持久化 (SQLite)
type Store struct {
    db *sql.DB
}

// Schema
// CREATE TABLE sessions (id TEXT PK, project TEXT, created_at INT, updated_at INT, model TEXT, mode TEXT);
// CREATE TABLE messages (id TEXT PK, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, created_at INT);
// CREATE TABLE config (key TEXT PK, value TEXT);

func (s *Store) CreateSession(project string) (*Session, error) { ... }
func (s *Store) LoadSession(id string) (*Session, error) { ... }
func (s *Store) ListSessions(project string) ([]*Session, error) { ... }
func (s *Store) AppendMessage(sessionID string, msg Message) error { ... }
func (s *Store) DeleteSession(id string) error { ... }
```

#### 3.4.5 Context Builder (上下文构建器)

```go
type ContextBuilder struct {
    systemPrompt string       // 基础 system prompt
    projectCtx   *ProjectCtx  // AGENTS.md / .minicode/rules
    skills       *SkillManager
}

func (b *ContextBuilder) Build(session *Session, userInput string) []Message {
    var messages []Message

    // 1. System prompt (基础指令 + 约定)
    sys := b.systemPrompt

    // 2. 项目上下文 (AGENTS.md)
    if b.projectCtx != nil {
        sys += "\n\n" + b.projectCtx.Content()
    }

    // 3. 匹配的 Skills
    for _, skill := range b.skills.Match(userInput) {
        sys += "\n\n" + skill.Instructions()
    }

    messages = append(messages, SystemMessage(sys))

    // 4. 历史消息 (带截断策略)
    messages = append(messages, b.truncateHistory(session.Messages)...)

    // 5. 当前用户输入
    messages = append(messages, UserMessage(userInput))

    return messages
}

// 历史截断策略: 保留最近 N 条 + 摘要更早的
func (b *ContextBuilder) truncateHistory(msgs []Message) []Message {
    maxTokens := 80000 // 预留 20% 给响应
    // ... token 计算与截断
}
```

#### 3.4.6 Extension Layer (扩展层)

**MCP 客户端**:
```go
type MCPManager struct {
    servers map[string]*mcp.Client
}

func (m *MCPManager) AddServer(name string, config MCPServerConfig) error {
    // 支持 stdio / sse / http 三种传输
    client, err := mcp.NewClient(config.Transport, config.Command, config.Args...)
    m.servers[name] = client
    // 自动注册 MCP 工具到 ToolRegistry
    return nil
}
```

**Skills 系统** (兼容 SKILL.md 标准):
```go
type Skill struct {
    Name        string
    Description string
    Instructions string  // SKILL.md 内容
    Path        string
}

type SkillManager struct {
    skills []Skill
    paths  []string  // 搜索路径: ~/.config/minicode/skills/, .minicode/skills/
}

// 自动发现: 扫描约定路径下的 SKILL.md 文件
func (s *SkillManager) Discover() error { ... }

// 关键词匹配: 根据用户输入匹配相关 Skill
func (s *SkillManager) Match(input string) []Skill { ... }
```

**Go 插件接口** (高级扩展):
```go
// 插件接口 (通过 Go interface + 编译时注册)
type Plugin interface {
    Init(registry *Registry) error
}

type Registry struct {
    Tools    *ToolRegistry
    Providers map[string]ProviderFactory
    Hooks    *HookManager
}

// 内置插件注册
func init() {
    PluginRegistry.Register("git", &GitPlugin{})
}
```

---

### 3.5 配置体系

```json
// ~/.minicode/config.json

{
  "autoApprove": false,
  "sandbox": false,
  "sandboxImage": "node:22-slim",
  "maxTurns": 50,
  "maxContextTokens": 200000,
  "mcpServers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    {
      "name": "github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  ],
  "skillsPaths": [],
  "plugins": [
    { "name": "auto-lint", "enabled": true, "config": {} },
    { "name": "git-status", "enabled": true, "config": {} },
    { "name": "file-watcher", "enabled": false, "config": {} }
  ]
}
```

**模型配置** (读取 opencode 的 `opencode.json`):
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

---

### 3.6 目录结构

```
minicode/
├── src/
│   ├── index.ts              # CLI 入口
│   ├── agent.ts              # Agent 核心循环
│   ├── provider.ts           # LLM Provider 工厂 (OpenAI/Anthropic/Google)
│   ├── config.ts             # 配置加载
│   ├── session.ts            # 会话持久化 (JSON)
│   ├── token-tracker.ts      # Token 用量追踪
│   ├── token-estimator.ts    # Token 估算
│   ├── skills.ts             # Skills 管理
│   ├── mcp.ts               # MCP 客户端
│   ├── plugins.ts            # 插件系统
│   ├── sandbox.ts            # Docker 沙箱
│   ├── server.ts             # HTTP/WS API 服务
│   ├── model-picker.ts       # 交互式模型选择器
│   ├── system-prompt.ts      # System prompt 构建
│   ├── user-message.ts       # 用户消息处理
│   ├── markdown.ts           # Markdown 渲染
│   ├── progress.ts           # 进度条
│   ├── spinner.ts            # 加载动画
│   ├── renderers.ts          # 渲染工具
│   ├── completer.ts          # 命令补全
│   ├── paste-input.ts        # 粘贴处理
│   ├── opencode-config.ts    # opencode 配置解析
│   ├── tools/
│   │   ├── index.ts          # 工具注册表
│   │   ├── bash.ts           # Bash 执行
│   │   ├── read.ts           # 读文件
│   │   ├── write.ts          # 写文件
│   │   ├── edit.ts           # 精确编辑 (search & replace)
│   │   ├── multi-edit.ts     # 批量编辑
│   │   ├── diff.ts           # diff 对比
│   │   ├── glob.ts           # 文件模式匹配
│   │   ├── grep.ts           # 内容搜索
│   │   ├── listdir.ts        # 列目录
│   │   └── todo.ts           # 任务列表
│   └── types.ts              # 类型定义
├── package.json
├── tsconfig.json
└── README.md
```

---

### 3.7 开发路线图

#### Phase 1: MVP (4 周)
> 目标: 能对话、能读写文件、能执行命令

- [x] 项目骨架 (TypeScript + Node.js)
- [x] Provider 层 (OpenAI 兼容 + Anthropic)
- [x] Agent 循环 (streaming + 工具调用)
- [x] 核心工具 (bash/read/write/edit/glob/grep)
- [x] 权限门控 (auto/ask/deny)
- [x] 基础 CLI (Commander 交互界面)
- [x] 配置文件 (JSON)

#### Phase 2: 可用性 (3 周)
> 目标: 会话持久化 + Skills + 项目上下文

- [x] JSON 会话持久化
- [x] 会话列表 / 恢复 / 删除
- [x] Skills 系统 (SKILL.md 自动发现)
- [x] 项目上下文 (AGENTS.md / .minicode/rules.md)
- [x] 上下文截断策略 (token 管理)
- [x] Todo 工具 (任务列表)
- [x] diff/multi_edit 工具

#### Phase 3: 扩展性 (3 周)
> 目标: MCP + 多 Provider + 插件

- [x] MCP 客户端 (stdio/sse/http)
- [x] Google Gemini Provider
- [x] 本地模型 Provider (Ollama)
- [x] 插件接口 (TypeScript module)
- [x] 内置插件 (auto-lint, git-status, file-watcher)

#### Phase 4: 体验优化 (2 周)
> 目标: 生产可用

- [x] Markdown 渲染 (代码高亮)
- [x] 流式输出优化 (打字机效果)
- [x] Token 用量追踪 + 成本估算
- [x] 沙箱执行 (Docker 隔离)
- [x] HTTP API 服务模式
- [ ] 安装脚本 (curl | bash)
- [ ] Homebrew / Scoop 包

#### Phase 5: 高级特性 (持续)
- [ ] Plan 模式 (只读分析)
- [ ] Hook 事件系统 (PreToolUse/PostToolUse/SessionStart)
- [ ] Subagent 机制 (并行搜索)
- [ ] Headless 模式 (CI/CD 集成)
- [ ] Desktop 应用 (Wails)
- [ ] 自定义 Agent Profile

---

### 3.8 关键设计决策

| 决策点 | 原设计方案 | 实际实现 |
|--------|-----------|----------|
| 语言 | Go | TypeScript/Node.js |
| TUI 框架 | Bubble Tea | Commander CLI |
| LLM 交互 | 原生 HTTP | 各 Provider SDK |
| 数据库 | SQLite (pure Go) | JSON 文件存储 |
| MCP SDK | mcp-go | @modelcontextprotocol/sdk |
| Skills 标准 | SKILL.md 兼容 | SKILL.md 兼容 |
| 配置格式 | YAML | JSON (opencode.json) |
| 插件机制 | Go interface | TypeScript module |
| 部署方式 | 单二进制 | npm 包 |

---

### 3.9 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Node.js 运行时依赖 | 部署需要 Node 环境 | 考虑未来迁移 Go 版本 |
| JSON 文件会话存储 | 并发写入可能丢失数据 | 后续升级 SQLite |
| 非 TUI 交互 | 用户体验受限 | 后续引入 Bubble Tea TUI |
| Provider API 变化 | 兼容性中断 | Provider 层抽象 + 版本化适配 |

---

## 四、总结

本方案的核心思路:

1. **借鉴 OpenCode 的分层架构** (core/tui/server 分离)，但用 Go 替代 TypeScript 实现单二进制部署
2. **采用 Crush 同款技术栈** (Go + Bubble Tea + MCP + Skills)，降低技术风险
3. **参考 Claude Code 的扩展模型** (Skills + Hooks + MCP)，融入生态而非自建
4. **MVP 优先** — 4 周交付可对话、可编码的最小可用版本，再逐步扩展

与现有工具的差异化:
- 比 OpenCode 更轻量 (单二进制 vs Bun 运行时)
- 比 Claude Code 更开放 (完全开源 vs 闭源核心)
- 比 Aider 更现代 (MCP + Skills vs 无扩展机制)
- 比 Crush 更聚焦编码 (内置编码工具 vs 通用 Agent)

---

## 五、MiniCode 实际实现

> 以下为当前代码库的实际实现状态，与上述 Go 方案设计有所差异。

### 5.1 技术栈

| 层 | 选型 | 实际依赖 |
|----|------|----------|
| **语言** | TypeScript (Node.js) | TypeScript 5.7 + Node.js 18+ |
| **LLM 交互** | 各 Provider SDK | `@anthropic-ai/sdk`, `openai`, `@google/generative-ai` |
| **MCP** | 官方 SDK | `@modelcontextprotocol/sdk` |
| **CLI** | Commander | `commander` |
| **Markdown** | Marked | `marked` + `cli-highlight` |
| **WebSocket** | ws | `ws` |
| **工具注册** | 自研 | 内置 10 个工具 + MCP 工具 |

### 5.2 实际目录结构

```
minicode/
├── src/
│   ├── index.ts              # CLI 入口
│   ├── agent.ts              # Agent 核心循环
│   ├── provider.ts           # LLM Provider 工厂
│   ├── config.ts             # 配置加载
│   ├── session.ts            # 会话持久化
│   ├── token-tracker.ts      # Token 用量追踪
│   ├── skills.ts             # Skills 管理
│   ├── mcp.ts               # MCP 客户端
│   ├── plugins.ts            # 插件系统
│   ├── sandbox.ts            # Docker 沙箱
│   ├── server.ts             # HTTP/WS API 服务
│   ├── model-picker.ts       # 交互式模型选择器
│   ├── tools/
│   │   ├── index.ts          # 工具注册表
│   │   ├── bash.ts           # Bash 执行
│   │   ├── read.ts           # 读文件
│   │   ├── write.ts          # 写文件
│   │   ├── edit.ts           # 精确编辑 (search & replace)
│   │   ├── multi-edit.ts     # 批量编辑
│   │   ├── diff.ts           # diff 对比
│   │   ├── glob.ts           # 文件模式匹配
│   │   ├── grep.ts           # 内容搜索
│   │   ├── listdir.ts        # 列目录
│   │   └── todo.ts           # 任务列表
│   └── *.ts                  # 其他工具函数
├── package.json
└── tsconfig.json
```

### 5.3 已实现功能

- ✅ **10 个内置工具**: bash, read, write, edit, multi_edit, diff, glob, grep, listdir, todo
- ✅ **多 Provider 支持**: OpenAI, Anthropic, Google Gemini, OpenAI 兼容 API
- ✅ **opencode 配置兼容**: 直接读取 `opencode.json`
- ✅ **MCP 支持**: stdio / sse / http 三种传输
- ✅ **Skills 系统**: 自动发现 `SKILL.md` 文件
- ✅ **会话持久化**: JSON 文件存储，可恢复对话
- ✅ **Token 追踪**: 每轮和会话级别用量统计
- ✅ **沙箱模式**: Docker 容器隔离 bash 执行
- ✅ **HTTP/WS API**: REST API + WebSocket 实时推送
- ✅ **插件系统**: 内置 auto-lint, git-status, file-watcher 插件
- ✅ **交互式模型选择**: 鼠标键盘操作

### 5.4 与设计方案的差异

| 项目 | 原设计方案 | 实际实现 |
|------|-----------|----------|
| 语言 | Go | TypeScript/Node.js |
| 数据库 | SQLite | JSON 文件会话存储 |
| TUI | Bubble Tea | Commander CLI (非 TUI) |
| 部署 | 单二进制 | npm 包 |
| 插件接口 | Go interface | TypeScript module |

### 5.5 后续优化方向

1. **性能优化**: 考虑迁移至 Go 版本实现单二进制部署
2. **TUI 增强**: 引入交互式终端界面
3. **数据库**: 升级至 SQLite 持久化
4. **MCP 工具发现**: 增强工具注册和权限管理
5. **Skill 匹配**: 引入更智能的 Skill 自动激活机制