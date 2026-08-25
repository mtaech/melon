# dsh-browser-tool

DSH（DeepSeek Harness）浏览器工具包：在 Agent 会话中驱动 Chromium 打开标签页、执行脚本、观察页面，并把截图/文本结果直接回传给模型。核心逻辑从 [oh-my-pi](https://github.com/omp) 的 browser 工具迁移而来，保持「open / run / close」三段式语义与 OMP 风格的 browser-relay。

## 能力

- **open** — 开一个命名标签页，四种浏览器来源：
  - **headless**：进程内启动无头 Chromium（`puppeteer-core` + `@puppeteer/browsers` 自动下载，支持 stealth 注入）；
  - **spawned**：detached 启动指定可执行文件（桌面应用/自研 App），通过空闲 CDP 端口 attach，关闭时随进程回收；
  - **connected**：连接已有 CDP 端点（`DSH_BROWSER_CDP_URL`）；不拥有浏览器，释放时只 disconnect；
  - **relay**：通过本地 Browser Relay（`dsh-browser-relay serve`）接管用户自己正在用的 Chrome，带标签页分组排队、debugger ban 恢复等 OMP 语义。
- **run** — 在标签页里运行 JS 单元（async 函数体 + 尾表达式自动返回值）：
  - 作用域：`page`、`browser`、`tab`（完整 Tab API：goto/observe/ariaSnapshot/screenshot/extract/click/type/fill/press/scroll/drag/waitFor*/evaluate/select/uploadFile/ref…）、`display`、`print`、`console`、`assert`、`wait`、`sleep`；
  - 输出：文本流 + 图片内容块（截图自动 resize 至模型像素预算）+ JSON 返回值；
  - `read/write/env/tree/tool/agent/parallel/pipeline/phase/log/budget` 等 omp 专属 helper 明确报错；
  - op 级超时低于 cell 预算（`OP_DEADLINE_SLACK_MS=1000`），超时走 tab worker recycle 或强制回收。
- **close** — 关闭标签页，可 `kill` 一并结束自己拥有的浏览器。
- **relay CLI**（`dsh-browser-relay`）：`serve`（HTTP+WS，伪装 Chrome CDP discovery `/json/version`、`/json/list`、`/cdp`）、`install`（把扩展装入 `~/.dsh/browser-relay/extension`）、`status`。扩展资产提交在 `src/assets/relay/extension-assets`。

## 结构

```
src/
  index.ts               工具注册（单工具 `browser`：open/run/close）
  config.ts              DSH_BROWSER_* 环境变量合并
  browsers/              浏览器核心
    registry.ts            四种 kind 的获取/持有/释放（引用计数）
    launch.ts              headless 启动、stealth、UA 覆盖、Chromium 下载
    tab-supervisor.ts      标签生命周期与 tab worker 编排
    tab-worker.ts          Tab API 实现（页面侧）
    runtime.ts             单元运行时（尾表达式返回、display/print）
    aria/aria-snapshot.ts  aria 快照与 ref 选择器
    final-expr.ts          Babel 末表达式注入（移植 omp returnFinalExpression）
  relay/                  Browser Relay
    server.ts               HTTP+WS 服务（/ext /cdp /json/*）
    bridge.ts              CDP 伪装：Target 域、minted tab/page 会话、OMP.claimTarget
    daemon.ts              空闲探测 + detached 拉起
    cli.ts                 serve|install|status
```

## 使用

```ts
import { defineTool } from "dsh-browser-tool"; // 无单独工具；作为 dsh-tools 定义
```

实际接入 DSH 时在插件/预置里注册：

```ts
import * as dshBrowserTool from "dsh-browser-tool";
ctx.tools.register(dshBrowserTool.default ?? dshBrowserTool.definition);
```

### 工具形态（LLM 视角）

```
browser action:"open"    name:"wiki" url:"https://en.wikipedia.org" headless:false
browser action:"run"     name:"wiki" code:"await tab.observe(); await tab.click('text/Log in');"
browser action:"close"   name:"wiki"
```

### 环境变量（均可选）

| 变量 | 作用 |
| --- | --- |
| `DSH_BROWSER_ENABLED` | 0 禁用工具 |
| `DSH_BROWSER_HEADLESS` | 1 默认 headless |
| `DSH_BROWSER_RELAY` / `DSH_BROWSER_RELAY_URL` | 1 时走 relay（默认 `http://127.0.0.1:9224`） |
| `DSH_BROWSER_CDP_URL` | 默认 connected 目标 |
| `DSH_BROWSER_SCREENSHOT_DIR` | 截图落盘目录 |
| `DSH_BROWSER_NO_WEBP` | 1 时模型副本用 PNG |
| `DSH_BROWSER_INSTALL_CHROME` | 0 不自动下载 Chromium |
| `PUPPETEER_EXECUTABLE_PATH` / `DSH_BROWSER_EXECUTABLE` | 指定 Chromium 可执行文件 |
| `PUPPETEER_PROXY_*` | 下载/Chrome 代理（透传 puppeteer） |

## 开发

```bash
npm run check      # tsc --noEmit
npm run build      # tsc + 资产拷贝（src/assets → lib/assets）
bun test           # 单元测试（util/kind/aria/run-output/runtime/bridge/relay-server）
npm run smoke      # 构建后用真实 headless Chromium 全链路冒烟
npm run relay -- serve --port 9224
```

## 与 omp 的差异

- 独立 npm 包：宿主运行时无法 import 包，按包方式交付；
- 去掉 omp 专属 helper（read/write/env/…），保留浏览器面；
- stealth 仅保留无侵入部分（`evaluateOnNewDocument` 脚本 + UA 覆盖），不套 omp 反检测 patch；
- 截图模型副本经 `sharp` 实现（Bun.Image 移除）；
- final-expression 注入用 `@babel/parser`（无 AST 不引入 babel 全家桶）。