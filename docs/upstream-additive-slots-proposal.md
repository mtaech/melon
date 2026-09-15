# 上游提议：给 `sidebar.workspaces` 增加 additive 槽位

> 起草于本仓库 `dsh-worksop-plus` 插件的 M3 阶段。产出目标是 DSH 侧的一条 issue / PR；**不是**本仓库要实现的代码。
> 状态：草案，待提交。

## 问题

`sidebar.workspaces` 是 `single` 槽，`replaceRisk: shadows-shipped-ui`。任何想增强这块面板的插件（置顶、分组、状态聚合、批量整理……）都只有一条路：**以更低 priority 整体接管该槽**。

后果是：

1. **能力二选一**。接管之后系统面板的全部能力（搜索、归档、拖拽、子代理 lineage、每区 5 条折叠、宿主持久化的手动顺序、`directoryFlow` 目录选择流程）都不再渲染，插件必须逐项复刻，否则就是功能倒退。本插件为此复刻了约 1300 行 UI，其中不少（子代理 lineage、扁平视图、5 条折叠）是纯粹为了「不倒退」而写的。
2. **槽位内的子洞无法复用**。`sidebar.workspaces.directoryFlow` 由系统条目声明，一个槽只能有一个声明者，接管者既不能复用也不能重新声明，只能自己实现一套目录选择（本插件即用 `uiWorkspace.listDirectory/createDirectory` 另写了一份）。
3. **升级易碎**。面板 DOM、行内交互、空会话/归档/未分组等不变量都在插件侧被复制，系统侧一旦演进，插件要跟着追。

## 提议

在 `sidebar.workspaces` 这条链上补一组 **additive 槽位**，让「增强」不必等于「替换」。按价值排序：

### 1. `sidebar.workspaces.section`（list）

在每个既有分组**之间/之后**渲染一个额外的分区，由所有者提供标题与该分区的内容。

- owner props：`{ wide, expandSidebar, useWorkspaces, useSessions, useSessionPendingInteraction }`（与 `sidebar.workspaces` 相同的标准 prop 面）。
- 用途：置顶区、分组区、自定义筛选区，都可以作为**额外分区**存在，而系统自己的 workspace 列表仍在原位渲染。
- 这是本插件最需要的一个：**置顶/分组本质上是「多一个分区」**，不需要接管整个区域。

### 2. `sidebar.workspaces.row.badge`（keyed，key = workspaceId）

在既有工作区行上追加一个行内徽标位。

- owner props：`{ workspaceId, wide }`。
- 用途：状态聚合（有会话等你 / 在跑 / 未查看完成）、计数、自定义标记——都不必复刻整行。
- 若担心与系统自身的计数/时间列争位宽：让系统行在存在占用时预留一个固定宽度的尾部位即可（本插件的实现里，把两个隐藏按钮从布局流里挪到绝对定位，就多还给了标签约 50px，效果良好）。

### 3. `sidebar.workspaces.row.action`（list，owner props 含 `workspaceId` / `sessionId`）

行内动作区（悬停显示）。用途：置顶、隐藏、移入分组等动作入口。

### 4. `sidebar.workspaces.directoryFlow` 的复用

目前该洞由系统条目声明，插件无法复用。建议允许**多声明者按 priority 竞争**，或显式提供「复用既有目录选择流程」的入口（例如把洞的 occupant 暴露为一个可渲染的构件），使接管者不必自带一套目录选择。

## 与现状的兼容性

- 全部为 `kind: 'list' | 'keyed'`，`replaceRisk: none`，不影响现有占用者与既有组合。
- 未占用时零渲染、零布局影响（`entries(key).length === 0` 即可隐藏外壳）。
- 现有插件（包括本插件）可以逐步从「整体接管」迁移到「加法注入」，接管路径仍保留给确实要重写面板的场景。

## 参考实现（本仓库）

- 本插件当前的接管实现与为此复刻的能力清单：`packages/worksop-plus/`（`src/client.js`、`src/styles.js`）、设计文档 `docs/worksop-plus-design.md` §1.1 与 §3。
- 这些缺口的具体复刻代价（约 1300 行 UI + 一份自建目录选择）可作为「为什么 additive 更划算」的论据。
