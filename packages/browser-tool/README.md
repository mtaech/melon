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

## 安装

作为 DSH profile 的 bundle 挂载。**先停掉正在运行的 dsh，再装** —— 在服务运行期间改它的 `node_modules` 会让运行中的进程读到残缺的依赖树。

```bash
cd ~/.dsh/profiles/<你的 profile>          # 例如 web
dsh plugin --profile <你的 profile> add dsh-browser-tool
```

从 npm 安装，`lib/` 已随包发布，装完即可用，无需本地构建。

然后在该 profile 的 `package.json` 里把它加进 `dsh.profile.bundles`（顺序放最后即可）：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-browser-tool"]
    }
  }
}
```

截图依赖 `sharp` 的原生模块，pnpm 默认会跳过它的构建脚本，需在 profile 的 `pnpm-workspace.yaml` 里放行：

```yaml
allowBuilds:
  sharp: true
```

重启 dsh 后 `browser` 工具即出现在工具列表中。验证：

```bash
dsh --profile <你的 profile> --dump-config | grep dsh-browser-tool
```

### 关于依赖

`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 声明为 **peerDependencies 而非 dependencies**，这一点很关键：DSH 通过 `~/.dsh/profiles/node_modules/@deepseek-ai/` 的符号链接农场把宿主运行时暴露给插件，插件不声明就会向上查找命中宿主那一份。

若把它们写进 `dependencies`，pnpm 会在 profile 里装第二份实体拷贝；`nodeLinker: hoisted` 下插件解析到近的那份、宿主用自己那份，两边模块实例不同。`dsh-tools` 的调度器挂在模块内的 `Symbol()` 上，跨实例读取得到 `undefined`，结果是**所有**工具调用都死在 `scheduler.prepare()`。

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
| `DSH_BROWSER_DONOR_CACHE` | 额外的 Chromium 复用来源（`@puppeteer/browsers` 缓存目录） |
| `PUPPETEER_EXECUTABLE_PATH` / `DSH_BROWSER_EXECUTABLE` | 指定 Chromium 可执行文件 |
| `PUPPETEER_PROXY_*` | 下载/Chrome 代理（透传 puppeteer） |

### Chromium 复用

需要 headless Chromium 时按以下顺序解析，只有全部落空才会下载：

1. `PUPPETEER_EXECUTABLE_PATH` / `DSH_BROWSER_EXECUTABLE`；
2. 系统已安装的 Chrome/Chromium（macOS 除外，那里优先用受管版本）；
3. 本包缓存里已有的 Chrome for Testing；
4. **其他工具缓存里已下载的版本 —— 直接复制，不重新下载**：`DSH_BROWSER_DONOR_CACHE`、`~/.omp/puppeteer`（oh-my-pi）、`PUPPETEER_CACHE_DIR`、`~/.cache/puppeteer`；
5. 以上都没有，才从 Chrome for Testing 下载。

第 4 步只认 `@puppeteer/browsers` 的缓存布局（`chrome/<platform>-<buildId>/`）。构建号完全一致时直接采用，否则取该缓存里最新的一版（仍然省掉一次下载）。复制的是整个构建目录并保留可执行位，落到本包缓存后即与来源解耦——oh-my-pi 清理自己的缓存不会影响这里。复制失败时退化为直接启动来源里的二进制。

Playwright 的缓存（`chromium-<revision>`）不在支持范围：它的 revision 编号无法映射到 Chrome for Testing 的 buildId。

## 开发

```bash
npm run check      # tsc --noEmit
npm run build      # tsc + 资产拷贝（src/assets → lib/assets）
bun test           # 单元测试（util/kind/aria/run-output/runtime/bridge/relay-server）
npm run smoke      # 构建后用真实 headless Chromium 全链路冒烟
npm run relay -- serve --port 9224
```

## 与 omp 的差异

- 以独立包交付，作为 profile bundle 挂载（宿主 Builtin 无法 import npm 包）；
- 去掉 omp 专属 helper（read/write/env/…），保留浏览器面，调用即报清晰错误；
- stealth 仅保留无侵入部分（`evaluateOnNewDocument` 脚本 + UA 覆盖），不套 omp 反检测 patch；
- 截图模型副本经 `sharp` 实现（Bun.Image 移除）；
- final-expression 注入用 `@babel/parser`（无 AST 不引入 babel 全家桶）。

## 许可

[MIT](./LICENSE) © 画野 (mtaech)

浏览器核心与 Browser Relay 的逻辑移植自 oh-my-pi 的 browser 工具。
