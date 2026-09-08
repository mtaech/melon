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

- **只在页面不在前台时通知**——`document.hidden` 为真（切走了标签页/最小化）、窗口失去焦点（你切到了别的应用，浏览器窗口还在后面）、或**事件属于你没在看的那个对话**（你在同页面的另一个会话里）时才算「没在看」，这三种情况都会弹。
- **提问/授权优先**：同一会话刚通知过提问/授权，紧接着的「回合结束」会静默，避免重复轰炸。
- **提问重提醒**：提问通知如果你正看着别的会话、或窗口不在前台，每 20 秒重弹一次（问题未答且 5 分钟内有效）——弹窗几秒就消失也不怕漏；你回到那个会话后自动停止。
- **回合结束带项目/会话**：正文会追加 `项目：<cwd 基名> · 会话：<会话标题或 id 前 8 位>`，一眼知道是哪个工程的哪个对话跑完了。
- **静默窗口**：同一会话、同一类型的通知默认 15 秒内只弹一次。
- **重连不漏**：`api-session/status` 只推送状态变化，页面刷新/重连时正在跑的回合收不到「开始」边沿；插件会从会话列表补齐运行状态，回合结束时照样通知。
- **水瀑事件不拦路**：`user-questions/request` 与 `approval/request` 是 waterfall，插件只负责通知，随后原样 `next()`，问题卡片照常渲染。
- 通知的 `tag` 按 类型+会话 分组，浏览器会替换仍在展示的同组通知；**点击通知会聚焦回 GUI 并跳到对应的那个会话**。

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
      onlyWhenHidden: true # 仅当页面不在前台（隐藏标签页/窗口失焦/在别的对话）时通知
      quietMs: 15000      # 同一会话同类通知的静默窗口（毫秒）
```

不配置时全部使用默认值；浏览器半会从 `GET /plugins/dsh-browser-notify/api/config` 读取解析后的配置（拿不到就用内置默认值，功能不中断）。

## 实现

分 host / client 两半：

- **Host 半**（`src/host.js`，cordis 插件）：声明 `Config` 并向宿主 webserver 注册 `GET /plugins/dsh-browser-notify/api/config`。
- **Client 半**（`src/client.js`，纯 JS，无 React）：经 `dsh.client.inject` 注入 `@deepseek-ai/dsh-api-gateway`，挂上 `ctx.remote`，订阅转发过来的 Remote 事件（`user-questions/request`、`approval/request`、`api-session/status`），按配置弹浏览器通知。

```
浏览器 (client bundle)
  ├─ remote.$on('user-questions/request' | 'approval/request' | 'api-session/status')
  │    └─ 标签页不可见 → new Notification(...)
  └─ fetch /plugins/dsh-browser-notify/api/config
       └─ host plugin (ctx.webServer)  → 解析后的 Config
```

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
