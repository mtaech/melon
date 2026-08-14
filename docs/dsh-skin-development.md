# DeepSeek Harness 皮肤开发参考文档

> 版本依据：`@deepseek-ai/dsh@0.1.0-rc.6`（仓库 `github.com/deepseek-ai/deepseek-harness`）
> 本文档由源码逆向整理，作为皮肤/主题开发时的备查资料。截至整理时，网上尚无公开的皮肤开发文档可索引。

---

## 1. 概述

DeepSeek Harness（下称 DSH）的皮肤系统不是传统意义上的"模板目录换肤"，而是一套
**CSS 变量（token）+ 主题注册机制**。

- **宿主侧**：负责持久化用户偏好、注入首屏反闪烁引导脚本。
- **客户端侧**：`ThemeRuntime` 服务持有实时主题偏好（`light`/`dark`/`system`），
  把 `system` 通过 `prefers-color-scheme` 解析成实际主题，发布不可变的
  `ThemeSnapshot`，并通过 `theme/change` 事件通知变化。
- **呈现侧**：`ThemeRuntime` 本身**绝不接触 DOM**；`ui-layout` 的 `ThemePresenter`
  负责把解析后的快照投影到 DOM。

关键包：

| 包 | 源码路径 | 职责 |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-theme` | `packages/client/ui-theme` | 主题服务、token 样式表、外观设置行 |
| `@deepseek-ai/dsh-client-ui-layout` | `packages/client/ui-layout` | `ThemePresenter`，DOM 应用器 |
| `@deepseek-ai/dsh-cordis-client-runner` | `packages/extensions/cordis-client-runner` | 动态插件的浏览器侧运行器 |

---

## 2. Token 体系

五张样式表（均在 `src/styles/`，由 web 壳的 `base.css` 导入）：

| 样式表 | 作用 |
| --- | --- |
| `base.css` | 字体、缓动、时长等上游基础变量 |
| `design-platform.css` | token 定义（静态尺度层 + 语义别名层） |
| `scrollbar.css` | `--dsw-alias-scrollbar-*` 的唯一消费方 |
| `gradient-shadow-text.css` | 渐变阴影文字 |
| `shiki.css` | 代码高亮（shiki）主题 |

> `scrollbar.css` 必须排在声明 `--dsw-alias-scrollbar-*` 的 `design-platform.css` 之后。

### 2.1 三层结构

1. **静态尺度层** `--dsw-static-*`：原始色值，是颜色的唯一权威来源。
   例如 `--dsw-static-deepseek-500: rgb(65, 118, 230)`、
   `--dsw-static-neutral-bluish-950: rgb(21, 21, 23)`。
   整层在 `body`（浅色）和 `body[data-ds-dark-theme]`（深色）下各声明一份。

2. **语义别名层** `--dsw-alias-*`：把语义名映射到静态层。
   例如 `--dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-1000)`。
   这是第三方皮肤"覆盖同名别名变量"的落点。

3. **specific 层** `--dsw-specific-*`：针对特定组件的映射。
   例如 `--dsw-specific-sidebar-fill`、`--dsw-specific-bubble`、
   `--dsw-specific-input-major`。

### 2.2 可作为覆盖目标的内建 token

以下语义 token 来自 `BUILTIN_INSPECT_TOKENS`，第三方皮肤注册时主要覆盖它们
（**全部要求 `light` + `dark` 双值**）：

| Token 名 | 说明 |
| --- | --- |
| `--dsw-alias-bg-base` | 应用基础背景 |
| `--dsw-alias-bg-layer-1` | 一级抬升表面背景 |
| `--dsw-alias-bg-layer-2` | 二级嵌套表面背景 |
| `--dsw-alias-bg-overlay` | 浮层/弹层背景 |
| `--dsw-alias-border-l1` | 主弱边框 |
| `--dsw-alias-border-l2` | 次强边框 |
| `--dsw-alias-brand-primary` | 主品牌强调色 |
| `--dsw-alias-label-primary` | 主文字色 |
| `--dsw-alias-label-secondary` | 次文字色 |
| `--dsw-alias-state-error-primary` | 错误状态色 |
| `--dsw-alias-state-success-primary` | 成功状态色 |
| `--dsw-alias-state-warn-primary` | 警告状态色 |
| `--dsw-specific-sidebar-fill` | 侧栏列与标题栏背景 |

> 完整别名清单见 `design-platform.css` 的 `body` 与 `body[data-ds-dark-theme]`
> 两个选择块，涵盖 `bg-*`、`border-*`、`brand-*`、`button-*`、
> `interactive-bg-*`、`label-*`、`markdown-*`、`state-*`、`scrollbar-*` 等前缀。

---

## 3. 主题 API（`ctx.theme`）

`ctx.theme` 是 `ThemeRuntime` 实例。类型定义在
`@deepseek-ai/dsh-client-ui-theme/client`。

### 3.1 关键类型

```ts
// ThemeTokens: --dsw-alias-* 覆盖表，变量名 → 色值
type ThemeTokens = Record<string, string>;

// 一个覆盖层里的单 token 值：浅/深两态都必填
interface ThemeTokenModes {
  light: string;
  dark: string;
}

// 覆盖层字典：token 名 → 双态值对
type ThemeTokenOverrides = Record<string, ThemeTokenModes>;

// 一个可选中主题
interface ThemeDefinition {
  id: string;                          // 主题 id（setTheme 的实参）
  colorScheme: 'light' | 'dark';       // 该主题基于哪套基础调色板
  tokens: ThemeTokens;                 // 别名层覆盖（作为内联 CSS 变量应用）
}

// 每次变化发布的不可变状态
interface ThemeSnapshot {
  preference: ThemePreference;          // 'light' | 'dark' | 'system'
  active: ThemeDefinition;              // 解析后的活动主题（覆盖层已折叠）
  themes: readonly ThemeDefinition[];   // 已注册主题，按注册顺序
  revision: number;                     // 单调递增的变更计数
}
```

### 3.2 `ThemeRuntime` 方法

| 方法 | 说明 |
| --- | --- |
| `getTheme(): ThemeSnapshot` | 读取当前不可变快照 |
| `setTheme(id: string): void` | 切换偏好；`system` 或已注册 id，未知 id 抛错 |
| `register(def: ThemeDefinition): () => void` | 注册第三方主题，返回 disposer |
| `overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void` | 叠加 token 覆盖层，返回 disposer |
| `exportInspectTokens(): ThemeTokenInspection[]` | 导出当前 token 目录（含注册/覆盖来源） |

### 3.3 事件

- `theme/change`（emit 模式）：偏好切换、注册表更新、或 `system` 下 OS 配色翻转时发出，
  参数为最新 `ThemeSnapshot`。

---

## 4. 注册第三方皮肤

核心入口是 `ctx.theme.register(definition)`。

```ts
const dispose = ctx.theme.register({
  id: 'my-skin',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#0b0d12',
    '--dsw-alias-brand-primary': '#7c5cff',
    '--dsw-alias-label-primary': '#e7eaf0',
    '--dsw-alias-border-l2': 'rgba(255,255,255,0.18)',
  },
});
```

### 4.1 `overrideTokens` 与 `register` 的区别

| | `register` | `overrideTokens` |
| --- | --- | --- |
| 是否进入注册表（可被 `setTheme` 选中） | 是 | 否 |
| 值形态 | `tokens` 是 `Record<string, string>`（单值） | `{ light, dark }` 成对 |
| 语义 | 注册一个完整可选主题 | 在活动主题上叠一个局部覆盖层 |

`overrideTokens` 的 `source` 参数是层身份（一个 source 一层），通常传插件包 id
（由动态包 façade 自动钉住）。同一 source 再次调用会整体替换该层并重新置顶
（effect 重注册语义）。层按 seq 顺序组合，后层逐 token 胜出。

> 覆盖值必须是 `{ light: string, dark: string }`，**不能是裸字符串**——
> 传裸字符串会抛教学性 `TypeError`，因为切到另一种配色时单值会不可读。

---

## 5. 插件如何接入（声明与挂载）

DSH 是 Cordis 插件架构，主题插件本身就是一个客户端插件。第三方皮肤通常也以插件形式
分发，通过 `ctx.theme` 注册。

### 5.1 包声明（`package.json` 的 `dsh` 字段）

标准形态（对齐社区模板 `Nagi-ovo/dsh-ads`）：

```json
{
  "name": "@deepseek-ai/dsh-skin-example",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-theme"
      ],
      "platform": "web"
    }
  }
}
```

- `dsh.bundle.patch`：声明本包是一个 **bundle patch 层**（指向自带 `cordis.patch.yml`）。
  `dsh plugin add` 后会自动把包名加入 profile 的 `dsh.profile.bundles`，无需手动编辑 profile。
- `dsh.client.inject`：声明客户端依赖的**包**，加载时注入（构建 boot manifest 加载顺序）。
- `dsh.client.platform`：`"web"`。
- `exports["./client"]`：**简单字符串**指向浏览器 bundle（`lib/client.js`）。
- 自带 `cordis.patch.yml`：用 `insert` 把插件行挂进加载列表：

```yaml
# cordis.patch.yml（随包分发）
- insert:
    - id: ui-skin-example
      name: '@deepseek-ai/dsh-skin-example'
```

> ⚠️ **inject 有两层，名字体系不同（踩坑点）**：
> - `package.json` 的 `dsh.client.inject` 写**包名**（`@deepseek-ai/dsh-client-runtime`…），
>   用于宿主侧组合 boot manifest（prefetch 顺序等）。
> - **客户端 bundle 里 `export const inject` 必须写服务名**（`theme` / `slots` / `locale` / `sessions`…），
>   这是 cordis fiber 真正等待的服务。写包名会导致 fiber 永远 pending：
>   `web boot: 1 entry did not activate ... pending (waiting for services: ...)`，
>   界面卡在 "Failed to load plugins"。
> - 服务名是各包在客户端 `ctx.provide(...)` 注册的名字：`dsh-client-ui-theme` 注册 `theme`、
>   `dsh-client-runtime` 注册 `sessions`/`workspaces`、`dsh-client-ui-layout` 注册 `layout`。
>   参考实现：`dsh-ads` 源码 `export const inject = ['slots', 'locale']`。
> - 用哪个服务就 inject 哪个：皮肤只用 `ctx.theme`，所以 `export const inject = ['theme']`。

### 5.2 客户端入口（`client.js`）

客户端插件体是 `apply(ctx)`，通过 `ctx.provide`/生命周期把服务接入上下文。
皮肤插件在 `apply` 里注册主题：

```ts
// lib/client.js
export const inject = ['theme']  // 服务名，不是包名（见 5.1 的 ⚠️）
export function apply(ctx) {
  const dispose = ctx.theme.register({
    id: 'my-skin',
    colorScheme: 'dark',
    tokens: { /* --dsw-alias-* 覆盖 */ },
  });
  // 在插件卸载时反注册
  ctx.effect(() => dispose, 'my-skin: unregister on dispose');
}
```

> Cordis 模块增强声明在 `@deepseek-ai/dsh-client-ui-theme/client` 中已经把
> `ctx.theme`、`theme/change` 事件补到 `Context` 上，皮肤插件直接使用即可。

### 5.3 安装与挂载

```bash
# file: 依赖（本地开发）；发布到 npm 后直接 `dsh plugin add <包名>`
dsh plugin --profile web add "file:/绝对/路径/到/皮肤包"
```

- `dsh plugin` 是 `pnpm` 转发器：在 `$DSH_HOME/profiles/web` 里执行 `pnpm add`。
- 装完后 `reconcilePlugins` 检测到包声明 `dsh.bundle`，自动把包名追加进
  `dsh.profile.bundles`（无需手改 profile）。
- 插件自带 `cordis.patch.yml` 的 `insert` 行随 bundle 层进入组合配置。
- **卸载**：`dsh plugin --profile web remove <包名>`（bundle 层自动移除）。
- **验证**：`dsh --profile web --dump-config` 应看到插件行，且来源标记为
  `# == <包名>`（自带 patch 层）。启动后浏览器引导图 `window.__DSH_BOOT__`
  含对应条目，`GET /plugins/<包名>/client.js` 返回 200。

---

## 6. DOM 应用与首屏引导

### 6.1 `ThemePresenter`（`ui-layout`）

- `html { color-scheme }`：原生 UA 控件（滚动条、表单控件）。
- `body[data-ds-dark-theme]`：切换调色板（来自 `active.colorScheme`，**不是 id**）。
- 活动主题的别名 token 覆盖作为内联 CSS 变量写到 `body`。
- 一个 presenter 自有的 `meta[name="theme-color"]` 跟随浏览器周边 UI 背景色。

纯 DOM 写入，无 React 参与；presenter 只回滚自己写过的东西，外部属性/内联样式不受影响。

### 6.2 宿主侧反闪烁引导

宿主侧（`apply` 的 `webServer.tapIndex`）在每份 index 响应里，紧接 `<body>` 起始标签
注入一段同步引导脚本，在 shell 加载页渲染前就设好 `color-scheme` 和
`body[data-ds-dark-theme]`，避免主题闪烁。偏好来自宿主 `ui-theme.preference` 设置，
无 settings provider 时默认 `system`。

---

## 7. 偏好持久化

- 设置命名空间：`ui-theme`，字段 `preference`（`light`/`dark`/`system`，默认 `system`）。
- 本地 provider 默认写入 `$DSH_HOME/settings.yaml`。
- 回环地址浏览器立即以 `system` 提供服务，后台再加载持久化偏好，并用 Host settings API 写回。
- **远程浏览器**无法访问特权 settings API，选择只保留在进程内。

---

## 8. 已知限制与注意事项

1. **第三方主题是扩展点，不是产品**：注册主题 = 覆盖同名别名变量，目前**不校验覆盖是否完整**。
2. **第三方主题 id 是进程内扩展**：不跨内置 settings schema；删除某个第三方主题绝不会
   覆盖最后一个持久化的内建偏好（持久化边界见 Host-backed preferences 决策）。
3. **token 样式表是颜色值的唯一权威**：缺失值（如设计里的 #4176E6 标签页蓝）有意不补，
   一律用最接近的语义 token。设计负责人批准的新值须以"一个静态尺度 + 一个语义别名"
   成对进入（如 `--dsw-static-blue-900` / `--dsw-alias-label-primary-bluish`）。
4. **`system` 是偏好，不是可注册 id**：`register` 传 `id: 'system'` 会抛错。
5. **重复 id 抛错**：`register` 对重复 id 抛错（`light`/`dark` 内建对子也算占用）。
6. **disposer 语义**：反注册（`register` 返回的 disposer）若撤掉当前活动偏好的主题，
   偏好会重置为默认值，避免 UI 保留未注册主题的 token。
7. **滚动条双路径互斥**：`scrollbar-width/color` 写在
   `@supports not selector(::-webkit-scrollbar)` 内（Firefox 标准属性），
   WebKit 系走伪元素；不要无条件同时声明，否则 hover token 无处渲染。
8. **覆盖值必须双态**：`overrideTokens` 传裸字符串会抛 `TypeError`（见 4.1）。

---

## 9. 最小示例（完整可参考）

```jsonc
// package.json
{
  "name": "@deepseek-ai/dsh-skin-nord",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-theme"],
      "platform": "web"
    }
  }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: ui-skin-nord
      name: '@deepseek-ai/dsh-skin-nord'
```

```ts
// lib/client.js
export const inject = ['theme']  // 服务名（见 §5.1 的 ⚠️）

export function apply(ctx) {
  const definition = {
    id: 'nord-dark',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': '#2e3440',
      '--dsw-alias-bg-layer-1': '#3b4252',
      '--dsw-alias-bg-layer-2': '#434c5e',
      '--dsw-alias-brand-primary': '#88c0d0',
      '--dsw-alias-label-primary': '#eceff4',
      '--dsw-alias-label-secondary': '#d8dee9',
      '--dsw-alias-border-l2': 'rgba(236,239,244,0.16)',
    },
  };
  const dispose = ctx.theme.register(definition);
  return dispose; // 或 ctx.effect(() => dispose, 'skin-nord: dispose')
}
```

---

## 附：源码定位速查

- 主题服务/API：`packages/client/ui-theme` 的 `lib/client.js`、
  `lib/types/client/index.d.ts`
- token 样式表：`packages/client/ui-theme/lib/styles/design-platform.css`
- DOM 应用器：`packages/client/ui-layout` 的 `theme-presenter`
- 宿主引导/持久化：`packages/client/ui-theme/lib/index.js`（`apply`、`bootThemeScript`）
