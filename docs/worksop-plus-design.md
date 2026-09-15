# 工作区面板增强插件（暂名 `dsh-worksop-plus`）调研与设计

> 状态：调研完成，**路线已定（A 全量接管 + L1 settings 持久化），M1 已实现并挂进 web profile**。
> 目标：解决左侧「工作区」列表太长、无法组织的问题（置顶、分组等）。
> 调研对象：DSH 源码 `~/Personal/Dev/Code/deepseek-harness`（packages 下真实 TS 源码）+ 已安装版本 `@deepseek-ai/dsh@0.1.6-alpha.1` + 本仓库现有插件。

## 实现进度（M1）

已落成 `packages/worksop-plus`（包名 `dsh-worksop-plus`，loader 行 id `worksop-plus`）：

| 文件 | 作用 |
| --- | --- |
| `src/derive.js` | 全部视图规则的纯函数实现（置顶/分组/隐藏/筛选/排序/相对时间） |
| `src/client.js` | 浏览器半：接管 `sidebar.workspaces`（priority -1）+ 侧栏底部开关 + settings 读写 + localStorage 缓存 + CSS |
| `src/host.js` | Host 半：注册 `worksop-plus` settings 命名空间（schemastery schema） |
| `test/derive.test.js` | 16 个单测覆盖派生规则 |
| `scripts/smoke.mjs` | 28 项断言：真实求值 `lib/client.cjs`、跑 `apply(fakeCtx)` 校验两处注册与 teardown、导入 `lib/host.js` 校验命名空间注册 |

验证：`pnpm --filter dsh-worksop-plus build` ✅ · `bun test` 16/16 ✅ · `node scripts/smoke.mjs` 28/28 ✅ · 整仓 `pnpm -r test` ✅ · 已 `dsh plugin --profile web add link:…`，`--dump-config` 显示 `- id: worksop-plus`。

**视觉层**：皮肤 `skin-material-you/src/sidebar.css` 原本就为这块面板定义了配方（tonal 卡片 / 引导线 / 固定时间列 / 44-40px 层级），但它作用于系统面板的 DOM；插件接管后这套 CSS 不再命中，因此配方被移植进 `src/styles.js`（同一套 `color-mix` 配方 + `--m3-*` token，带 fallback）。另附 `scripts/preview.mjs`：静态渲染真实组件做离线视觉自检。

M2 也已落地（0.1.3）：**多选整理**（批量置顶/取消/移入分组/隐藏/全选）、**拖拽**（拖入分组、置顶排序、分组重排）、**分组 emoji**、**配置导入导出**、**置顶同步到宿主顺序**、**会话重命名**。排序数学被抽成 `derive.js` 的 `moveIdBefore` / `hostOrderWithPinned` 纯函数并单测覆盖。

**状态可见性**（未发版）：`useSessionPendingInteraction`（槽位标准 prop）+ 系统同源的 `StateDot` 提供状态点；纯函数层把 pending/running/completed 聚合到**工作区**与**分区**两级（`sectionStatus`），因此折叠的桶也会显示「有会话等你 / 在跑 / 有未查看完成」，含同类计数与紧急度排序（approval > question > plan-review）。

**未分组/已隐藏可折叠**（0.1.7）：`prefs` 新增 `ungroupedCollapsed` / `hiddenCollapsed`（schema 加字段带默认值，旧文档照常通过校验），四个桶的折叠状态都持久化；`folded = collapsed` 让 chip 化规则覆盖所有桶。折叠是显示层行为——成员、计数、`assign` 都不动（有单测固定这一点）。

**折叠组 chip 化**（0.1.6）：折叠态分组的组头压成 26px chip（品牌色 6% + 22% 描边 + 全圆角），一串折叠组读起来像一排标签而不是一列空标题；位置仍按分组顺序，展开态保持 caption 样式与内容。

**计数内联**（0.1.5）：会话数从右侧胶囊改为紧跟名字的 `(n)`——标签不再是 flex 增长项，改用显式 spacer 维持时间列右对齐；名字过长时 `(n)` 仍紧随省略号之后。

**chip 行定宽**（0.1.4）：分组数量与筛选行宽度解耦——一行永远是 `全部 / ★置顶 / 分组 ▾ / +`，分组名进下拉菜单（带计数、勾选）；无分组时不出现该 chip。批量条的「完成」固定在滚动区之外，窄栏下也不会退不出多选。

**M3 完成**（未发版）：分组内**手动排序**（schema 新增 `order` 映射，`applyStoredOrder` 保序并把新成员追加到尾部；顺带修掉「置顶区未按 `pinned` 数组排序」的 M2 遗留）、**拖拽插入指示线**（按落点半程决定 before/after）、**宿主内容搜索**（`sessions.search` + 防抖取消 + 内容匹配分区 + 去重基准改为**可见树**）、**子代理 lineage**（`runningSubagentCounts` 汇总到父行，子代理不再占顶层行）、**工作区右键菜单**；搜索期间空分区自动收起。

**M3 收尾（未发版）**：会话级拖拽排序（宿主持久化）、每工作区 5 条 + 展开更多、扁平列表视图、活跃定时任务图标、会话 fork、应用内目录浏览器、菜单换成产品 `Menu`（缺失时回退自带 popup）、rail 打磨（置顶项 + 状态徽标 + 点开即展开）。上游 additive 槽的提议已成文：`docs/upstream-additive-slots-proposal.md`。

### 规划中仍未完成

原计划内的三项均已落地：菜单已用产品 `Menu`、rail 已打磨、上游提议已成文（`docs/upstream-additive-slots-proposal.md`，待提交 issue）。

### 对照系统面板，本插件**没有**做（不在原计划内，按需再定）

对照清单里的六项也已全部补齐（会话拖拽、扁平视图、5 条折叠、定时任务指示、fork、应用内目录浏览器）。

---

---

## 0. 一句话结论

DSH 左侧「工作区」整块区域就是 **一个 single 槽 `sidebar.workspaces`**——注册进去就能完全接管（已有先例：本仓库 `dsh-model-select-plus` 用 `priority: -1` 换掉了 composer 的模型座位）。
但「置顶 / 自定义分组 / 隐藏」这类**视图组织元数据，官方模型里根本不存在**，必须由插件自己持有和持久化。
推荐方案：**client 半阴影替换面板 + host 半持久化 JSON + 一键回退原生面板**。

---

## 1. 现状盘点：系统面板已经有什么（不要重造）

| 能力 | 系统现状 | 证据 |
| --- | --- | --- |
| 工作区顺序 | **已支持拖拽排序，且是宿主持久化的权威顺序** | `ui-workspace/src/client/index.ts:122`（`insertWorkspaceBefore`）、`api-workspace-controller/src/types.ts`（`WorkspaceOrderValue`） |
| 视图分组 | 仅「按工作区分组 / 扁平列表」两种模式 | `ui-workspace/src/client/stores.ts`（`groupBy: 'workspace' \| 'flat'`） |
| 排序方式 | 手动顺序 / 最近更新 | 同上（`orderBy: 'manual' \| 'updated'`） |
| 会话管理 | 重命名、归档(archive)、fork、子代理 lineage、运行/待交互/新完成状态点 | `ui-workspace/src/client/rows/Rows.tsx`、`tree.ts` |
| 搜索 | 本地标题/路径匹配 + 宿主会话内容搜索 | `WorkspaceBrowser.tsx`（`searchSessions` / `deriveSearchResults`） |
| 新建工作区 | 目录选择流程（`sidebar.workspaces.directoryFlow` 子槽，原生选择器或应用内浏览） | `contract/slots.ts`（`DirectoryFlowOwnerProps`） |
| 折叠策略 | 每组默认最多 5 条 + 「展开更多」；空会话只显示当前选中的那个 | `WorkspaceBrowser.tsx:43`（`COLLAPSED_SESSION_LIMIT = 5`） |

**结论**：缺的恰好就是要做的——置顶、自定义分组、隐藏、过滤、批量操作。其余能力应当保留。

另外两条硬约束（已核实）：

1. **官方 registry 装不下这些元数据**：`dsh-workspace` 的记录 schema 是 `z.core.$strip`（自定义字段在下次 open 时被静默丢弃），storage domain 同名只能开一次（插件无法自行 open `workspace`），`WorkspaceRegistry` / `WorkspaceView` / `ctx.remote.workspace` 都没有 pin/group 扩展点 → 往 registry 加字段等于 fork `dsh-workspace` 并做存储版本迁移，代价与收益不成比例。
2. **当前这版 DSH（`0.1.6-alpha.1`）没有内置置顶**：源码 checkout 里 grep 不到 `session/pin` / `setPinned` / pin 投影，所以社区插件提到的「内置 session-pin 服务」不在我们这版里。

### 1.1 生态先例（npm 上已有替代品，必须先看）

| 包 | 它做什么 | 与我们的关系 |
| --- | --- | --- |
| `dsh-session-pin` | 置顶**工作区与会话**到列表最前（走 `ctx.workspaces` 重排宿主顺序）+ 每行颜色 + Boards（置顶项分组）+ 标签/筛选视图/`/goto`。**不替换 `sidebar.workspaces`**：用 `conversation.session.header.actions`、`sidebar.footer.action`、`shell.overlay` 等加法位，会话行靠 DOM overlay；持久化用 host 侧 `settings` 命名空间（`session-pin` section）+ localStorage 降级 | 验证了两件事：①「置顶 = 重排宿主顺序」可行且已被社区采用；②`settings` 命名空间 + `settingsScope` 是持久化视图偏好的成熟做法。它**没有**做「列表内的自定义分组」——分组只存在于它自己的置顶面板里 |
| `dsh-better-sidebar` | 是**右侧** VS Code 式面板（explorer/editor/terminal/git/browser），不是左侧工作区列表 | 不相干，但占了 `better-sidebar` 这个名字，命名要避开 |

**结论**：置顶这一半已有成熟替代品；真正的差异点是**「列表内的真分组 + 隐藏 + 过滤 + 批量」**，而这几项只有接管 `sidebar.workspaces` 之后才可能。

---

## 2. 可用扩展点（全部已核实，含源码证据）

### 2.1 槽位地图

`sidebar.workspaces`（来自 `cordis_inspect Slots.listSubTree`）：

- kind `single`，scope `root`，replaceRisk `shadows-shipped-ui`，声明者是 `sidebar` 条目。
- owner props（仅两个）：`wide`（侧栏是否展开）、`expandSidebar()`。
- standard props（框架自动给）：`useWorkspaces`、`useSessions`、`usePanelInfo`、`useSessionPendingInteraction`、`useResource`。
- 子槽：`sidebar.workspaces.directoryFlow`（**已被系统条目声明**；一个槽只能有一个声明者）。

不替换任何东西的**纯叠加座位**同样可用：`sidebar.panellist`（全局面板图标）、`sidebar.footer.action`（设置旁动作）、`main`（keyed，keyDomain 开放，目前只占了 `conversation`）、`settings.section` / `settings.plugins.tab`、`shell.overlay`。

### 2.2 覆盖机制（`packages/client/ui-slots/src/index.ts`）

- 同一 cell 同 `priority` 重复注册会**抛错**；不同 priority 构成 shadowing，**最低 priority 渲染**（`:757-763`、`:835-841`）。
- 系统注册在默认 `priority: 0`；插件注册 `-1` 即接管。
- **系统条目仍然留在 ledger 里**，只是不再渲染。我们 `dispose()` 自己的注册后，原生面板**立刻恢复**——这就是最好的回滚开关。
- `children` 一槽一声明者（`:864-871`）。我们**不需要**声明 `directoryFlow`，因为可以自己实现「添加工作区」。

运行时可 `require` 的模块（浏览器 shell seed 表原文，`dsh-web-frontend/dist/assets/index-C04Zg7TP.js`）：

```js
react, "react/jsx-runtime", "react-dom", "react-dom/client",
"@deepseek-ai/cordis", "@deepseek-ai/dsh-client-store",
"@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives",
"@deepseek-ai/dsh-client-ui-dockkit"
```

即：**官方 UI 原语（Button / Menu / Modal / Tooltip / Input / Switch / StateDot / DisclosureRow …）可以直接复用**，外观天然一致。

两个实现层面的坑：

- seed 表按**精确 specifier** 命中，所以 `require('@deepseek-ai/dsh-client-ui-primitives')` 可以，写成 `.../client` 会 miss（`stripClientSuffix` 之后找不到 graph 行）。
- **动态 Cordis 插件做不了 host 侧持久化**：host 半沙箱闭包只有 `ctx / harness / console / btoa / atob / TextEncoder / TextDecoder`，`require`、`fetch`、定时器全被屏蔽，也拿不到 `zod` / `defineDomain`。所以 M0 原型只能把状态放内存或浏览器 localStorage；**要正式落盘必须做成 melon 静态包**。

### 2.3 客户端数据与服务

- `useWorkspaces` → `WorkspaceSnapshot { items: WorkspaceView[], archivedSessionIds, phase, state }`
  - `WorkspaceView { workspaceId, path, title, sessionIds（手动序）, createdAt, updatedAt }`
- `useSessions` → `SessionListState { ids, byId: Record<SessionId, SessionSummary>, current }`
  - `SessionSummary { id, title?, displayTitle, cwd?, parentId?, origin?, running, completed?, blank, updatedAt, projectionValues? }`
- `ctx.get('workspaces')`：`create` / `rename` / `delete` / `archiveSession` / `unarchiveSession` / `insertSessionBefore`；`insertBefore`（顺序移动）在 `WorkspaceController` 类上存在，inspect 目录未列出——实现前用 inspect 复验一次。
- `ctx.get('uiWorkspace')`：`startSession` / `openWorkspace` / `openSession` / `forkSession` / `connectWorkspace` / `archiveSession` / `unarchiveSession` / `pickDirectory` / `listDirectory` / `createDirectory`。
- `ctx.get('sessions')`：`open` / `search` / `fork` / `scope` / `binding`。
- `ctx.get('locale')`（注册自己的词典）、`ctx.get('theme')`、`ctx.get('timer')`（防抖）。
- 持久化：`@deepseek-ai/dsh-client-store` 内部就是 localStorage（`packages/client/store/src/index.ts:139-161`），且它是 seed word，可直接 require；也可以自己写 localStorage。

### 2.4 必须复刻的既有不变量（否则功能退化）

1. **空白会话**：只有当前选中的 blank 会话可见（`tree.ts` 文档注释）。
2. **归档会话**：任何分组面都不显示（`archivedSessionIds`）。
3. **未归入任何工作区的会话**：进「未分组」桶（`UNGROUPED_KEY = ''`，`tree.ts:26`）。
4. **rail（侧栏折叠）模式**：原生只渲染一个搜索入口按钮（`WorkspaceBrowser.tsx:1230-1246`）；我们的替身必须给等价的可点入口，不能白屏。
5. 分组头要带：会话数、当前会话高亮、每组默认 5 条 + 展开更多。

---

## 3. 三条实现路线对比

| 维度 | **A. 全量替换（推荐）** | B. 包装原生面板 | C. 纯叠加管理页 |
| --- | --- | --- | --- |
| 做法 | 注册 `sidebar.workspaces` @ `priority:-1`，自己渲染整个区域 | 从 ledger 读系统组件（`ctx.slots.entries()` 暴露 `component`），在其上方加置顶条 | 只加 `sidebar.panellist` + `main` 管理页；用 `insertBefore` 把顺序物化成「置顶在前/按组聚簇」 |
| 置顶 | 独立置顶区，完全控制 | 顶部置顶条（列表内会重复出现，需额外处理） | 靠宿主顺序，无独立视觉 |
| 分组 | 真分组（组头、折叠、计数、拖拽） | **做不到**（组头必须插进列表内部） | 只能聚簇排序，列表里没有分组视觉 |
| 工作量 | ~700–900 行 React（复用原语 + 宿主服务） | ~200 行适配层，但依赖内部 props 形状 | ~300 行，风险最低 |
| 风险 | 需要复刻既有能力；靠「一键回退」兜底 | 系统组件 props 组合是内部实现，rc 升级易碎 | 解决不了「不好管理」的核心诉求 |
| 回退 | 一行 disposer，原生面板立刻回来 | 无侵入 | 无侵入 |

**推荐 A**，并把 B 的思想（低风险回退）作为 A 的内建开关。

如果只想要「置顶」，其实不必写代码——装 `dsh-session-pin` 就行；它走的正是 C 的思路（加法槽 + 重排宿主顺序 + settings 持久化）。**我们自研的唯一理由是它没有的那部分：列表内的真分组、隐藏、过滤、批量。**

---

## 4. 插件设计

### 4.1 包结构（照 melon 约定）

- 包名 `dsh-worksop-plus`，cordis 行 id `worksop-plus`，`cordis.patch.yml` 用 `insert`。
- **host 半**（`lib/host.js`）：只做一件事——`ctx.inject(['settings'], c => c.settings.register('worksop-plus', Schema))` 把持久化命名空间登记进 DSH（见 4.2）。必要时再挂 `ctx.webServer.register({kind:'prefix', path:'/plugins/dsh-worksop-plus/api', ...})` 作为备选通道（照 `model-select-plus`）。
- **client 半**（`lib/client.cjs`，esbuild + `window.__ModuleLoader__.load`）：`export const inject = ['slots','workspaces','uiWorkspace','sessions','locale','timer']`，`apply(ctx)` 里注册槽位；CSS 走 `<style data-plugin>` + `ctx.effect` 回收（照 `model-select-plus`）。
- 另需：`scripts/smoke.mjs`（断言 bundle 形态、factory 可物化、`apply(fakeCtx)` 注册/销毁干净、host 半在 fake settings 上登记了命名空间）、`README.md`、根 README 包表 +1 行。

### 4.2 元数据存哪（推荐 L1，L0 做缓存）

**为什么不能写进宿主 registry**：记录 schema 是 `z.core.$strip`（自定义字段下次 open 就被丢）、storage domain 同名只能开一次（插件开不了 `workspace`）、公开接口与 wire 投影都没有扩展点 → 等于 fork `dsh-workspace` + 存储版本迁移。

| 层 | 手段 | 落点 | 评价 |
| --- | --- | --- | --- |
| L0（缓存） | `require('@deepseek-ai/dsh-client-store').defineStore({ init, persist: 'dsh.workspace.pins.v1', actions })` | 浏览器 localStorage | 系统面板自己对同一块状态就是这么做的（`dsh.workspace.view.v5`），秒级可用；但仅本机本浏览器（桌面 webview 与 Chrome 各一份） |
| **L1（推荐，权威）** | host 半 `ctx.settings.register('worksop-plus', Schema)`（zod）；client 半 `ctx.settingsScope.bind({ namespace: 'worksop-plus' })` | `$DSH_HOME/settings.yaml` 的 `worksop-plus:` section | 官方现成的双向通道：`getSnapshot()` / `subscribe()` / `set(field, value)` / `unset(field)`，自带 revision 冲突检测与串行写队列，**零 HTTP 管道**；`dsh-session-pin` 与官方 `ui-theme` / `ui-conversation` 都是这个做法 |
| L2（备选） | host 半 `ctx.storageDomain.open(defineDomain({ name: 'workspace_plus', version: 1, global: { schema, initial } }))` | `$DSH_HOME/storages/workspace_plus.json` | 语义更干净（不污染 settings.yaml），有 schema 校验、原子写与 `domain/changed` 事件；但 client 读不到，需要自己补 webServer 路由或 RPC |

**推荐：L1 权威 + L0 缓存**——启动先用 localStorage 缓存渲染（不闪烁），随后与服务端快照对齐；写操作乐观更新，失败回滚。若以后想彻底不碰 `settings.yaml`，平移到 L2 只需换掉 host 半的存储实现，数据结构不用动。

数据形状（同一份 JSON 既可作 settings section，也可作 storage domain 的 `global`）：

```json
{
  "pinned": ["<workspaceId>"],
  "groups": [
    { "id": "g_work", "name": "工作", "emoji": "💼", "color": "blue", "order": 0, "collapsed": false }
  ],
  "assign": { "<workspaceId>": "g_work" },
  "hidden": ["<workspaceId>"],
  "prefs": { "pinCollapsed": false, "sort": "manual", "showHidden": false }
}
```

- **只存 `workspaceId`（uuid），绝不存 path / title**：改名、移动目录自动跟随（官方注释：`WorkspaceId` 是 generated uuid, never the path）。
- 已被删除的工作区做**惰性清理**：按当前快照过滤未知 id，写回时顺手 prune。
- 命名规则不同，别写错：settings 命名空间用**小写连字符**（`worksop-plus`），storage domain 名只能 `[a-z][a-z0-9_]*`（`workspace_plus`）。

### 4.3 面板信息架构

```
[★ 置顶 (2)                    ▾]     ← 可折叠；置顶行永远在最上
[全部 5 | ★ 2 | 工作 3 | 个人 2 | +]  ← 分组筛选 chips（带计数）+ 新建分组
[▾ 工作 (3)                       ⋯]  ← 组头：折叠、重命名、改色、上移/下移、删除分组、在此新建会话
   ├ 工作区行  ⌄ lumix-tool   (1)  5天   [★] [⋯]
   │    └ 会话行  标题 · 状态点
   └ …
[▸ 个人 (2)]
[未分组 (2)]
[+ 添加工作区 · ⚙ 更多（导入/导出/使用系统面板）]
```

### 4.4 行操作

- 工作区：置顶/取消置顶、移入分组…、重命名、隐藏、删除（危险色 + 二次确认）、新建会话。
- 分组：重命名、改色/emoji、折叠、上移/下移、删除分组（成员退回未分组）。

### 4.5 与宿主能力的配合（关键取舍）

- 置顶与分组**默认只存在于我们自己的视图元数据里**，不改宿主注册表——避免和系统拖拽排序互相打架。
- 可选开关「把置顶物化到宿主顺序」：对置顶项调用 `insertBefore` 写到权威顺序，这样 TUI / 其他前端也能看到置顶。默认**关**。
- 「隐藏」= 仅本面板不显示，**不**动宿主注册；提供「显示已隐藏」入口。

### 4.6 注册骨架（纯 JS，无 JSX）

```js
export const name = 'dsh-worksop-plus'
export const inject = ['slots', 'workspaces', 'uiWorkspace', 'sessions', 'locale', 'timer']

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  ctx.effect(() => ctx.locale.register('worksopPlus', { zh, en }))
  const disposeCss = injectStyle()          // <style> 标签，theme token 配色
  ctx.effect(() => disposeCss)
  ctx.effect(() => slots.inject('sidebar.workspaces', () => slots.register(
    {
      name: 'sidebar.workspaces',
      priority: -1,                          // 低于系统条目的 0 → 接管；dispose 后自动回退
      locale: 'worksopPlus',
      inject: () => ({ state, actions }),     // settings 命名空间读写 + 视图派生
    },
    WorkspacePlusBrowser,                    // React.createElement 手写
  )))
}
```

「使用系统面板」= 调用这次注册返回的 disposer；「恢复增强面板」由常驻的 `sidebar.footer.action` 入口负责（即使增强面板被关也能点回来）。

### 4.7 i18n / 主题 / 无障碍

- 词典自己注册（`zh` + `en`），文案不硬编码中文。
- 颜色一律用 `--dsw-*` token；尊重 `prefers-reduced-motion`；行菜单键盘可达，`aria-expanded`/`role="tree"` 与原生对齐。

---

## 5. 分期计划

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| **M0（半天）** | 用**动态 Cordis 插件**在当前 GUI 里做原型：只做「置顶 + 分组 chips + 只读列表」，验证数据形状与交互假设 | 不改仓库、不落盘，进程重启即消失 |
| **M1（1–2 天）** | 落成 melon 包：`settings` 命名空间持久化 + 置顶/分组/隐藏 CRUD + 一键回退 + smoke | 可用版本，可 link 进 `~/.dsh/profiles/web` |
| **M2** | 过滤/批量多选/排序/拖拽/rail 打磨 + 导入导出 + README | 完整版本 |
| **M3（可选）** | 向 DSH 上游提议 additive 槽（如 `sidebar.workspaces.pinStrip`），让增强不必再 shadow | 上游 issue / PR |

> M0 的动态插件只能验证**交互与数据形状**，不能验证持久化（host 沙箱拿不到 `zod`/`defineDomain`，也没有 `require`）；持久化留到 M1 的静态包里做。

安装（开发期，无需发布）：

```bash
cd ~/Personal/Dev/Code/melon && pnpm install && pnpm --filter dsh-worksop-plus build
dsh plugin --profile web add link:/home/huang/Personal/Dev/Code/melon/packages/worksop-plus
# client bundle 变更后刷新页面；（patch 层自身有 patchReload: live）
```

---

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| shadow 之后能力回退（搜索/归档/拖拽/子代理行） | 内建「一键回退原生面板」；M0 原型先验证信息密度是否够用；逐步补齐而非一次砍掉 |
| 与系统拖拽排序语义冲突 | 默认不动物主顺序；「置顶物化」是显式开关 |
| DSH rc 升级导致契约漂移 | 只依赖**已公开的槽契约与 client 服务**，不 require 内部模块路径；smoke 断言 + catalog 版本对齐 |
| 隐藏的工作区里还有运行中的会话 | 隐藏行保留运行角标（或直接禁止隐藏 running 的行） |
| 工作区很多时的性能 | 派生只在过滤/搜索时计算，行级 memo；避免每帧重建 group 索引 |
| 官方以后自己加了置顶/分组 | 我们的数据模型保持可导出，退化为「迁移到原生」的工具即可 |

---

## 7. 待决策

1. **要不要自研**：先装 `dsh-session-pin` 用现成的置顶（零成本，但没有列表内分组）/ 自研（拿到分组+隐藏+过滤+批量）。
2. **路线**：A 全量替换（推荐，能拿到列表内真分组）/ B 包装原生面板（保留 100% 原生面板，只能加顶部置顶条）/ C 纯叠加管理页（零风险，列表里没有分组视觉）。
3. **元数据存哪**：L1 `settings` 命名空间（推荐，跨浏览器/前端共享）/ L0 仅浏览器 localStorage（最省事，换浏览器即丢）。
4. **是否把置顶物化到宿主顺序**（影响 TUI / 其他前端可见性；`dsh-session-pin` 的做法是物化，默认开）。
5. **是否先做 M0 动态插件原型**（可以在当前这个 GUI 里直接看到效果，不落仓库）。

---

## 附录：证据索引

**DSH 源码**（`~/Personal/Dev/Code/deepseek-harness`）

- 槽契约与注册语义：`packages/client/ui-slots/src/index.ts`（shadowing `:757-763`、`:835-841`；children 单声明者 `:864-871`；`StoredEntry` 暴露 `component` `:596-611`）
- 面板实现：`packages/client/ui-workspace/src/client/{index.ts,rows/WorkspaceBrowser.tsx,rows/Rows.tsx,tree.ts,stores.ts,contract/slots.ts}`
- 宿主工作区 API：`packages/api/workspace-controller/src/{types.ts,index.ts,client/service.ts,client/model.ts}`
- 侧栏壳：`packages/client/ui-sidebar/src/client/{SidebarRoot.tsx,contract/slots.ts}`
- 客户端 store 持久化（localStorage）：`packages/client/store/src/index.ts:139-161`
- settings 宿主登记 + 客户端通道：`packages/client/ui-theme/src/index.ts`（`ctx.settings.register`）、`packages/client/ui-theme/src/client/index.ts:420-430` 与 `packages/client/ui-conversation/src/client/apply.ts:46-127`（`ctx.settingsScope.bind`）、`packages/client/ui-settings/src/client/settings-scope.ts`
- 独立存储域：`packages/storage/storage-domain/README.md`、`packages/storage/storage-domain/src/spec.ts`（`defineDomain` / `domainTable`）
- 浏览器模块表（seed words）：已安装包 `dsh-web-frontend/dist/assets/index-C04Zg7TP.js` 的 `staticModules`

**已安装 DSH（`0.1.6-alpha.1`）**

- `dsh-base/cordis.patch.yml`：`settings`(:90)、`storage`/`storage-json`/`storage-domain`(:145-156) 已挂载 → 两条持久化路线都不需要改组合
- `dsh-workspace/lib/types/spec.d.ts`：`workspaceRecord` 是 `z.core.$strip`、domain 名 `workspace` v2
- `~/.dsh/storages/workspace.json`：真实 registry 落盘（含 14 个工作区的 uuid）
- `~/.dsh/settings.yaml`：真实 settings section 形态（`ui-theme:` / `agent-presets:` …）
- `dsh-cordis-host-runner/lib/types/sandbox.d.ts`、`dsh-cordis-client-runner/lib/client.js`：动态插件两半的可用全局（持久化限制的依据）

**生态先例**

- `dsh-session-pin`：https://www.npmjs.com/package/dsh-session-pin （host `settings` 命名空间 + 加法槽 + DOM overlay 的完整参考实现）
- `dsh-better-sidebar`：https://www.npmjs.com/package/dsh-better-sidebar （右侧面板，命名避让）

**本仓库先例**

- `packages/model-select-plus/src/{client.js,host.js}`：`priority:-1` 替换座位 + webServer 路由 + `<style>` 注入
- `packages/skin-material-you/src/sidebar-enrich.js`：已有的左侧面板 DOM 增强（反例：能用槽就别用 DOM）
