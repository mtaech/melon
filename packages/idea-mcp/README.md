# dsh-idea-mcp

DSH（DeepSeek Harness）插件：把 **IntelliJ IDEA 内置 MCP Server** 的能力包装成一组一等公民 agent 工具。

IDEA 的 MCP 对外只暴露 **一个** 路由工具 `execute_tool`——参数是一条 `工具名 --flag value` 的命令行字符串。模型得自己记住几十个工具名、参数名和引号规则，还得每次手工指定 `projectPath`，否则调用直接被拒。本插件直连 IDEA 的 MCP 服务（stdio 或 SSE），把这件事接管掉：

- **一个能力一个工具**：`idea_search_symbol`、`idea_lint_files`、`idea_build_project`…… 参数有 JSON Schema 校验，模型不用背命令语法；
- **跨工程自动解析**：按 agent 会话的 `cwd` 匹配 IDE 当前打开的工程（含 `.worktrees` 嵌套场景），自动带上 `projectPath`；
- **兜底逃生口**：`idea_execute_tool` 可以按原始命令行调用任意 IDEA MCP 工具（数据库、调试器、覆盖率等）。

## 能力

| 工具 | 说明 |
|---|---|
| `idea_status` | 连接状态：传输方式、端点、握手到的 IDEA 版本、当前打开的工程 |
| `idea_projects` | 列出 IDE 当前打开的工程 |
| `idea_search_symbol` | 用 IDEA 索引按名字搜符号（类/方法/字段），返回文件+行列 |
| `idea_search_file` | 按文件名模糊搜文件 |
| `idea_get_symbol_info` | 对指定文件/行/列取 Quick Doc 与声明 |
| `idea_get_file_problems` | 单文件 inspections（含未解析引用等语义问题），可只看 error |
| `idea_lint_files` | 批量 inspections，一次汇总多个文件的问题 |
| `idea_analyze_calls` | 调用层次：谁调它（`INCOMING_CALLS`）/ 它调谁（`OUTGOING_CALLS`） |
| `idea_build_project` | 用 IDEA 的工程模型编译，返回错误与警告（可 `rebuild`、可只编指定文件） |
| `idea_project_modules` | 工程模块列表 |
| `idea_project_dependencies` | 工程依赖（库 + 模块间） |
| `idea_git_status` | IDEA 视角的 VCS 状态：仓库、当前分支、未提交变更 |
| `idea_execute_tool` | 逃生口：任意 IDEA MCP 工具的原生命令行（描述里附完整命令目录） |

## 安装

发布后：

```bash
dsh plugin --profile <你的 profile> add dsh-idea-mcp
```

**本地开发**装当前 checkout 时，要先打包再装——直接指向包目录会被 DSH 的 peer 兼容预检拒绝，因为本地 manifest 里的 `@deepseek-ai/dsh-*` 是 `catalog:` 协议，预检无法与运行时版本比对（`pnpm pack` 会把 `catalog:` 替换成真实范围）：

```bash
pnpm --filter dsh-idea-mcp pack --pack-destination packages/idea-mcp/dist
# 然后在会话里用 plugin_manager：install_bundle，target 指向
#   <repo>/packages/idea-mcp/dist/dsh-idea-mcp-0.1.0.tgz
```

（`dist/` 已在仓库 `.gitignore` 里。）改完 `src/` 要重新 build + pack + 重装才会生效。

本地迭代有三个坑（都实测过）：

1. **必须 bump `version` 再 pack**。同版本同路径时 `plugin_manager` 会判定 `changed: false`（报 `ambiguous-install`），pnpm 不会重新解包，profile 里还是旧代码。
2. **装完新版本要重启 DSH**。替换已安装的包会返回 `application: restart-required`——运行中的 host 仍持有旧模块实例，重启后才加载新 JS。
3. **别删仍被 profile 引用的 tgz**。profile 的 `dependencies` 记着具体文件路径，删掉后 install 会直接 `ENOENT`；要等新版本装好、依赖指向新文件之后再清理旧包。

装好后会话里直接出现 `idea_*` 工具。**前提**：IDEA 已打开，且 Settings | Tools | MCP Server 勾选了 *Enable MCP Server*。

## 配置

bundle 的 patch 行可按需覆盖：

```yaml
- insert:
    - id: dsh-idea-mcp
      name: 'dsh-idea-mcp'
      config:
        transport: stdio          # stdio（默认）| sse
        command: ''               # 留空则自动探测 idea 启动器
        args: ['stdioMcpServer']
        url: ''                   # 留空则由 port 推导 http://127.0.0.1:<port>/sse
        port: 0                   # 0 表示用 IJ_MCP_SERVER_PORT，再退回 64342
        projectPath: ''           # 写死工程路径；留空则按会话 cwd 自动解析
        requestTimeoutMs: 120000
        idleTimeoutMs: 600000     # 空闲多久断开（stdio 会回收代理进程）
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `transport` | `stdio` | `stdio` 拉起 `idea stdioMcpServer` 代理；`sse` 直连 IDE 自己监听的 MCP 端口，少一个进程 |
| `command` / `args` | 自动探测 / `['stdioMcpServer']` | stdio 传输的可执行文件与参数 |
| `url` | `http://127.0.0.1:<port>/sse` | SSE 传输的端点 |
| `port` | `64342` | stdio 传给代理的 `IJ_MCP_SERVER_PORT`；也是 SSE 默认端口 |
| `projectPath` | 自动 | 写死后所有调用都作用于该工程 |
| `requestTimeoutMs` | `120000` | 单次 MCP 请求超时（`idea_build_project` 单独放宽到 15 分钟） |
| `idleTimeoutMs` | `600000` | 空闲这么久后断开连接，下次调用自动重连；`0` 表示常驻 |

### 环境变量

优先级：`DSH_IDEA_MCP_*` > 配置块 > IDEA 自己的 `IJ_MCP_SERVER_*` > 自动探测。

- `DSH_IDEA_MCP_ENABLED` / `DSH_IDEA_MCP_TRANSPORT` / `DSH_IDEA_MCP_URL` / `DSH_IDEA_MCP_COMMAND` / `DSH_IDEA_MCP_PORT` / `DSH_IDEA_MCP_PROJECT_PATH`
- `DSH_IDEA_MCP_REQUEST_TIMEOUT_MS` / `DSH_IDEA_MCP_IDLE_TIMEOUT_MS`
- `IJ_MCP_SERVER_PORT`（IDEA 标准变量）、`IJ_MCP_SERVER_PROJECT_PATH`

## IDEA 没启动时会怎样

**插件本身不依赖 IDEA 在跑**：`apply()` 只把 13 个工具注册到 tools registry，不建立任何连接，所以 DSH 不会因为 IDEA 没开而起不来或启动变慢。连接是懒的——第一次调用 `idea_*` 时才连。

连接前会先探测目标端口（`127.0.0.1:<port>`，或 SSE 端点的 loopback 主机）：

| 情况 | 行为 |
|---|---|
| IDEA 没运行 / MCP Server 没启用 / 端口配错 | **毫秒级失败**，报 `127.0.0.1:<port> 上没有服务在监听`，并说明怎么处理。stdio 传输**不会**去 spawn 那个注定失败的代理进程 |
| IDEA 启动后重试 | 直接成功。失败状态不缓存，下一次调用自动重连 |
| IDEA 中途被关掉 | 当前调用报错（stdio 代理退出 / SSE 流断开），后续调用自动重连 |
| 只想看状态 | 调 `idea_status`：它不抛异常，返回 `connected: false` + 失败原因 + 已打开工程 |

实测依据：`idea stdioMcpServer` 在端口无人监听时 **0.5 秒退出（exit 1）且不会启动新 IDE 进程**——它只是把 stdio 桥到 IDE 的 `IJ_MCP_SERVER_PORT` 上的纯代理。非 loopback 的 SSE 端点不做预检，直接让真实连接决定结果，避免误判。

## 跨工程解析

IDEA 的 MCP 在不知道 `projectPath` 时会直接拒绝调用（**不会**因为只开了一个工程就自动选中），只在拒绝信息里附上已打开工程列表。本插件的处理：

1. 命中 `projectPath` 配置 → 直接用；
2. 否则探测 IDE 打开的工程列表（结果缓存 30 秒）；
3. 用会话 `cwd` 去匹配：取**路径最长**的那个包含 `cwd` 的工程（所以 `.worktrees/xxx` 子目录会命中 `.worktrees` 而不是外层 checkout）；
4. 只有一个工程且 cwd 不匹配 → 用这个工程（符合单人单窗口的直觉）；
5. 都不匹配 → 报错并列出所有打开工程，提示切 cwd 或显式传 `projectPath`。

## 保证 agent 真的调用它

工具schema 只解决"能发现"，不解决"会被优先选"。除了 13 个工具定义，插件还通过 `ctx.systemPrompt.section()` 注入一段系统提示（顺序 2250，紧挨内置的 LSP 工具说明），说明这些工具何时比 grep 强、以及连不上时该退回普通文件工具。

前提条件清单：

| 条件 | 说明 |
|---|---|
| IDEA 打开着**同一个工程目录**（或会话 cwd 的祖先） | 插件按会话 cwd 匹配打开的工程；对不上会报错并列出所有工程。多 worktree / 多工程时可写死 `projectPath` |
| Settings \| Tools \| MCP Server 勾选 *Enable MCP Server* | 没勾选时端口不监听，插件毫秒级报错 |
| **索引已就绪** | 刚切分支、Gradle sync、`idea` 冷启动后 IDEA 在重建索引：此时 `idea_search_symbol` 可能返回空/不全，`idea_get_file_problems` 可能返回 `"timedOut": true`。等 IDEA 右下角索引进度条走完再重试 |
| 前端半边 | 全栈项目里 Vue/JS 部分需要 IDEA 装了 JavaScript 插件、且前端模块在同一个工程内；`idea_project_dependencies` 会同时返回 npm 依赖 |

**模型会不会真的用它**：提示段落针对实测中模型的真实犹豫做了三件事——① 明确 `projectPath` 是按会话 cwd 自动解析的、对不上会带着工程列表报错，**不需要先探测**；② 明确什么样的问法该用它（跨重载/接口的符号解析、inspections、调用层次、编译验证），并承认唯一字面量用文本检索就够；③ 点出 `idea_analyze_calls` 只看 JVM 内调用方，**Spring/REST 端点的真实调用方在 HTTP 另一侧**，要配合前端里对 URL 的文本检索——这是 Java 全栈项目里最容易误判的一处。

**与 bash 脚本型 skill 的关系**：`ijidea-mcp` / `ijidea-mcp-database` / `ijidea-mcp-debugger` 这类 skill 会把 IDEA 包成 `~/.local/bin/ijidea-mcp` 脚本调用。同一次实测里模型并没有加载它们（直接上手工具），所以它是**潜在**而非主要的竞争路径；但在把 skill 当作强约束的会话里仍可能绕过插件。若你在同一 profile 里两者都装，建议把这些 skill 改成"优先用 `idea_*` 工具，脚本仅在未装插件时兜底"。

自检只需一次调用：`idea_status` 会给出传输方式、端点、握手到的 IDEA 版本、已打开工程，以及在连不上时的确切原因。

## 已知限制

- IDEA MCP 的工具集随 IDE 安装的插件而变。数据库、调试器（`xdebug_*`）、覆盖率工具来自可选插件，未安装时 `idea_execute_tool` 会拿到 `Tool '<name>' not found`。
- IDEA 的命令行解析要求**每个 flag 都带值**：`--errorsOnly true` 合法，裸 `--errorsOnly` 会被拒（插件已按此编码）。
- 服务端在 `invocationMode: VIA_ROUTER` 下不提供 `resources/*`、`prompts/*`，本插件只桥接 tools。
- 一次 `idea_build_project --rebuild true` 可能跑很久，注意 `requestTimeoutMs` 与工具自身的超时预算。

## 开发

```bash
pnpm --filter dsh-idea-mcp build     # tsc -> lib/
pnpm --filter dsh-idea-mcp check     # tsc --noEmit
pnpm --filter dsh-idea-mcp test      # bun test（纯函数单测）
pnpm --filter dsh-idea-mcp smoke     # 端到端：内置 mock IDEA MCP 服务，stdio + SSE 双跑
```

`lib/` 是构建产物，不入版本控制。`scripts/smoke.mjs` 加载的是 `lib/`，改完 `src/` 要先 build。

## 许可

MIT
