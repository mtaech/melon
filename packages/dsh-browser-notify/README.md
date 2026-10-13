# dsh-browser-notify

把 DeepSeek Harness Web GUI 的「需要你处理」变成**浏览器系统通知**的 dsh 插件。

当 agent 结束回合、向你提问或请求工具授权时，如果你没有盯着那个标签页，就完全无法感知——dsh-browser-notify 在后台利用浏览器的 [Notification API](https://developer.mozilla.org/docs/Web/API/Notification) 弹出系统通知，点一下通知即可回到 GUI。

## 触发场景

| 事件 | 通知内容 | 默认 |
|---|---|---|
| `user-questions/request`（agent 提问） | 问题文本（截断 110 字）+ 前三个选项 + 题数 | ✅ |
| `approval/request`（工具授权） | 工具名 + 授权原因 | ✅ |
| `api-session/status`（回合结束 → 等待输入） | “回合已完成，等待你的输入 · 项目 / 会话” | ✅ |

细节：

- **区分主 Agent 和子代理**：副标题会写明事件来自**主 Agent** 还是**子代理**——子代理的通知标题是「子代理提问 / 子代理需要授权 / 子代理已结束回合」，正文追加 `项目：… · 子代理：<子代理标题> · 父会话：<父会话标题>`，一眼分清是当前对话本身还是某个 teammate / `subagent` 调用；点通知会跳到**那个子代理的对话**（`ui-workspace` 会把子代理会话 id 解析成 subagent 地址，落在子代理面板上）。判定读的是会话列表行上的 `origin: "subagent"` / `parentId`，列表还没出现该子代理时退回 `sessions.subagentAddress(id)` 解析，两条路都拿不到才算主 Agent。不想被 teammate 打断时把 `subagents` 设为 `false`，就只留主对话的通知。
- **只在页面不在前台时通知**——`document.hidden` 为真（切走了标签页/最小化）、窗口失去焦点（你切到了别的应用，浏览器窗口还在后面）、或**事件属于你没在看的那个对话**（你在同页面的另一个会话里）时才算「没在看」，这三种情况都会弹。
- **浏览器发不出就走宿主原生通知**：浏览器通知按**源**授权，而直接在**系统浏览器**里开 `dsh web`（尤其 `--port 0` 每次换端口）时，每次启动都是一个新源、权限永远停在 `default`——只走 `Notification` 的话**什么都看不到**。所以页面拿不到权限时（不支持 / `denied` / 申请后仍未授予），会把同一条通知 `POST /plugins/dsh-browser-notify/api/notify` 交给宿主进程，由它用 `gdbus`（KDE/GNOME 自带）或 `notify-send` 发系统通知——不需要权限、不依赖源。宿主报告自己根本没有通知器时（`available: false`，如 Windows），页面会记住并停止重试。（官方 dsh-desktop 的页面源固定为 `dsh-app://app`，外壳的会话权限处理器又对通知一律放行，正常走的是上面那条浏览器通知的路，不会落到这里。）
- **提问/授权优先**：同一会话刚通知过提问/授权，紧接着的「回合结束」会静默，避免重复轰炸。
- **提问重提醒**：提问通知如果你正看着别的会话、或窗口不在前台，每 20 秒重弹一次（问题未答且 5 分钟内有效）——弹窗几秒就消失也不怕漏；你回到那个会话后自动停止。
- **回合结束带项目/会话**：正文会追加 `项目：<cwd 基名> · 会话：<会话标题或 id 前 8 位>`，一眼知道是哪个工程的哪个对话跑完了。
- **静默窗口**：同一会话、同一类型的通知默认 15 秒内只弹一次。
- **重连不漏**：`api-session/status` 只推送状态变化，页面刷新/重连时正在跑的回合收不到「开始」边沿；插件会从会话列表补齐运行状态，回合结束时照样通知。
- **水瀑事件不拦路**：`user-questions/request` 与 `approval/request` 是 waterfall，插件只负责通知，随后原样 `next()`，问题卡片照常渲染。
- 通知的 `tag` 按 类型+会话 分组，浏览器会替换仍在展示的同组通知；**点击通知会跳到对应的那个会话**（走 `ctx.uiWorkspace.openSession`，`ui-workspace` 才是 DSH 客户端导航的归属方），在桌面壳里还会先请外壳把窗口抬到前台（见下）。原生兜底通知只能展示，点它不会跳转（OS 通知的点击回不到页面）。

### dsh-desktop（Electron 外壳）里的跳转

在**系统浏览器**里，点通知由浏览器自己把窗口/标签页抬到前面，插件再切到对应会话，所以「跳转」看起来是完整的。

在 **dsh-desktop** 里（Electron，页面跑在 `dsh-app://app/`）光有「切到对应会话」还不够：Electron 对 renderer 通知的点击只把事件派发回页面（`shell/browser/notifications/platform_notification_service.cc` 的 `NotificationClick` 仅做 `DispatchNonPersistentClickEvent`），并不会激活窗口，而 renderer 里的 `window.focus()` 也抬不动原生窗口（`WebContents::ActivateContents` 只通知观察者）。所以插件在点击时先调外壳暴露的 `window.dshDesktop.window.focus()`：它走 `dsh-desktop:window-focus` IPC 到主进程，复用外壳自己的 `focusPrimaryWindow()`（`restore()` + `show()` + `focus()`），把窗口从托盘、别的应用后面叫到前台，再切到对应会话。

外壳较旧、没有这个桥时插件会跳过这一步（点击仍然切到对应会话，只是窗口要自己用托盘/Dock/任务栏叫出来）——不报错，行为与加桥之前一致。

## 安装

```bash
dsh plugin --profile <你的 profile> add dsh-browser-notify
```

重启 `dsh web` 后即生效。

### 通知权限必须由一次点击触发

浏览器普遍要求**用户手势**才弹通知权限框：Firefox ≥ 72 会直接静默拒绝没有手势的 `Notification.requestPermission()`；Chromium 系（Chrome / Edge）的「防滥用通知」策略同样经常不弹、只留一个地址栏图标。旧写法只在「该发通知的那一刻」申请权限，那时没有任何手势，权限就永远停在 `default`，于是什么通知都不会出现。所以插件会在页面加载后的**第一次点击 / 按键**时申请权限，允许后稍等片刻会弹一条「通知已开启」确认。

如果当时点了「阻止」，或错过了那次询问，可以点地址栏左侧的权限图标手动改成「允许」，之后无需重启页面即生效。

## 配置

Host 半声明了 schemastery `Config`，可用 profile 的 `cordis.patch.yml` 覆盖（profile 默认 `patchReload: live`，改完即时生效）：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- config:
    id: dsh-browser-notify
    $data:
      question: true      # agent 提问时通知
      approval: true      # 工具请求授权时通知
      roundEnd: true      # 回合结束等待输入时通知
      subagents: true     # 子代理（teammate / subagent 调用）也通知；false 则只通知主对话
      onlyWhenHidden: true # 仅当页面不在前台（隐藏标签页/窗口失焦/在别的对话）时通知
      quietMs: 15000      # 同一会话同类通知的静默窗口（毫秒）
```

不配置时全部使用默认值；浏览器半会从 `GET /plugins/dsh-browser-notify/api/config` 读取解析后的配置（拿不到就用内置默认值，功能不中断）。

> **装完没反应？先确认插件被挂载了。** DSH 只加载 profile `package.json` → `dsh.profile.bundles` 里列出的 bundle；只出现在 `dependencies` 里**不会**被挂载（profile 被重置/迁移后常出现这种「包装了但没挂载」）。自检：
>
> ```bash
> curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/plugins/dsh-browser-notify/api/config   # 200 = 已挂载，404 = 没挂载
> ```
>
> 没挂载就把 `dsh-browser-notify` 加回 `dsh.profile.bundles`（或重跑 `dsh plugin --profile <profile> add dsh-browser-notify`），然后**重启** `dsh web` / dsh-desktop——bundle 列表在启动时组合，改完必须重启。

## 实现

分 host / client 两半：

- **Host 半**（`src/host.js`，cordis 插件）：声明 `Config`，向宿主 webserver 注册 `GET /plugins/dsh-browser-notify/api/config`（解析后的配置）与 `POST /plugins/dsh-browser-notify/api/notify`（原生通知兜底，响应里的 `available` 告诉页面这台宿主到底有没有通知器）。
- **Client 半**（`src/client.js`，纯 JS，无 React）：经 `dsh.client.inject` 注入 `@deepseek-ai/dsh-api-gateway`，挂上 `ctx.remote`，订阅转发过来的 Remote 事件（`user-questions/request`、`approval/request`、`api-session/status`），按配置弹通知；页面拿不到浏览器通知权限时改用上面的 host 兜底路由。

```
浏览器 (client bundle)
  ├─ remote.$on('user-questions/request' | 'approval/request' | 'api-session/status')
  │    └─ 标签页不可见 / 在看别的会话 → Notification 权限 granted？
  │         ├─ 是 → new Notification(...)
  │         │        └─ onclick → window.dshDesktop.window.focus()（桌面壳）
  │         │                    └─ ctx.get('uiWorkspace').openSession(sessionId)
  │         └─ 否 → POST /api/notify → host → gdbus / notify-send（无权限、无源）
  ├─ 会话列表 byId 行（title/cwd/origin/parentId）→ 主 Agent vs 子代理 标题与正文
  ├─ localStorage['dsh.sessions.current']  ← 读「当前在看哪个会话」（ui-workspace 写入）
  └─ fetch /plugins/dsh-browser-notify/api/config
       └─ host plugin (ctx.webServer)  → 解析后的 Config
```

客户端契约上有两处容易踩空，插件都按 DSH 真实形状读取：

- **导航在 `uiWorkspace`**：`ctx.sessions`（session-controller）**没有** `open()`，它的注释明确写着导航属于 view owner；`ctx.get('uiWorkspace').openSession(id)` 才是跳转入口（旧版 `sessions.open()` 仍作为兜底尝试）。
- **当前会话不在会话列表里**：`SessionListState` 只有 `ids` / `byId` / `phase` 等，没有 `current`；「正在看哪个对话」由 `ui-workspace` 以 `{ sessionId }` 持久化在 `localStorage['dsh.sessions.current']`，插件优先读快照里可能出现的 `current`，读不到再读这个键。

数据面完全在浏览器内（通知不经过 host），host 只是配置的声明与出口，遵循 `plugin-dashboard` / `model-select-plus` 的 webserver+fetch 模式。

## 开发

```bash
pnpm install          # workspace 安装
pnpm run build        # esbuild 打包 src/client.js → lib/client.cjs，拷贝 host 到 lib/
pnpm run smoke        # 用 fake 驱动 host 配置路由与 client 事件→通知主流程
```

`lib/` 为构建产物、已被 `.gitignore` 忽略；`npm publish` 会在 `prepublishOnly` 阶段自动构建。

## License

MIT
