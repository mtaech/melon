# model-select-plus

对 DeepSeek Harness 网页端 **模型选择弹窗**（composer 底部左侧的 `conversation.input.model` 座位）的信息增强式重写。

基于 `deepseek-harness` 源码实现，核心数据路径完全复用官方会话模型目录，而不是自造数据：

- Host 侧通过 `ctx.apiProxy.sessions.models({ sessionId })` 和 `ctx.apiProxy.sessions.selectModel({...})` 读取/写入真实目录与选择——这正是运行期 apiproxy 的 `session.models` / `session.selectModel` 处理器，选中后会正确设置该会话 Agent 的实时选择引用并保存默认模型（无需触碰私有 `sessionController` 引用）。
- Client 侧把默认的 `ModelSelect` 替换为自定义组件，注册到 `conversation.input.model` 单座位，`priority: -1`（低于官方占位的 `0`，按“数值小者渲染”被选中）。

## 优化点

1. **信息增强**：每个模型行显示名称、所属 provider 标签与 `description`；每个推理等级显示 `name`（title 提示 `description`）。
2. **推理等级快捷切换**：模型行内直接渲染等级 chips（含“默认”），点一下即切换模型+推理等级，无需二级钻取。
3. **搜索过滤**：按模型名 / 描述 / provider 名过滤。
4. **收藏置顶**：行首星标收藏，收藏项置顶为独立分组（进程内内存保存，插件生命周期内有效）。
5. **视觉打磨**：使用 `--dsw-alias-*` 主题令牌，浅色/深色主题自适应；悬浮/选中态、圆角、阴影、滚动。

## 文件

- `src/client.js` — 浏览器端插件本体（`conversation.input.model` 单座位替换）。
- `src/host.js` — Host 端 `harness.handle` 两个私有 RPC：`mdsl.catalog`、`mdsl.select`。
- 组件通过 Client→Host 私有 JSON RPC（`host.call`）访问 `mdsl.catalog` / `mdsl.select`。

## 如何转为可持久安装的 dsh 插件包

参考 `packages/plugin-dashboard`：

1. `src/client.js` 作为 client 入口，用 esbuild 打成 `lib/client.cjs`（沿用 `scripts/build-client.mjs` 思路，注入 `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-locale`）。
2. `src/host.js` 作为 host 入口，通过 `cordis.patch.yml` 在宿主组合里挂载插件行。
3. `package.json` 的 `dsh.client.inject` 声明所需 client 服务（`@deepseek-ai/dsh-client-ui-slots`）。
4. `dsh` 会把 client 包打进 `window.__DSH_BOOT__` 运行时，host 包由组合实例化。

> 本目录当前仅作参考实现，未配置 `package.json`，不会进入 pnpm workspace 构建。
