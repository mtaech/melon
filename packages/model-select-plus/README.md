# dsh-model-select-plus

对 DeepSeek Harness 网页端 **模型选择弹窗**（composer 左下角 `conversation.input.model` 座位）的信息增强式重写，打包为一个可安装、可发布到 npm 的 dsh 插件。

## 特性

1. **信息增强**：模型按 provider 分组，行内显示名称、2 行截断描述；推理等级以 chips（含“默认”）呈现，悬停可见说明。
2. **推理等级一键切换**：行内点等级 chip 即切换模型+推理等级，无需二级钻取。
3. **搜索**：按模型名 / 描述 / provider 过滤，带放大镜图标与清除按钮。
4. **收藏置顶**：行首星标收藏，收藏项置顶为独立分组（插件生命周期内的浏览器内存保存）。
5. **视觉打磨**：`--dsw-alias-*` 主题令牌，浅/深色自适应；面板入场动画、quiet 触发按钮、细滚动条、居中的 SVG 星标。

## 安装

把本包加进 dsh profile 的依赖即可（配合 `dsh.bundle.patch` 自动挂载 host / client 双侧）：

```bash
# 在 dsh profile 目录里
pnpm add dsh-model-select-plus
# 或
npm i dsh-model-select-plus
```

重启 `dsh web` 后，composer 的模型选择框即被替换。

- Host 侧（exports `.`）通过 `cordis.patch.yml` 挂载，向宿主 webserver 注册
  `GET /plugins/dsh-model-select-plus/api/catalog` 与 `POST /plugins/dsh-model-select-plus/api/select`。
- Client 侧（exports `./client`）由 `dsh.client` 注入加载，替换 `conversation.input.model` 占位（`priority: -1`）。

两个 API 都调用宿主的 `ctx.apiProxy.sessions.models / selectModel`——这是运行期 apiproxy 的真实目录与选择处理器，复用 `session.models` / `session.selectModel`，选中后会正确设置会话 Agent 的实时选择引用并保存默认模型。

## 数据路径

```
浏览器 (client bundle)
  └─ fetch /plugins/dsh-model-select-plus/api/{catalog,select}
       └─ host plugin (ctx.webServer)  →  ctx.apiProxy.sessions.{models,selectModel}
```

（持久化插件避免动态插件的 `harness`/`host` 内建，采用与 `plugin-dashboard` 相同的 webserver+fetch 模式。）

## 开发

```bash
pnpm install          # workspace 安装
pnpm run build        # esbuild 打包 src/client.js → lib/client.cjs，并拷贝 host 到 lib/
pnpm run smoke        # 校验 lib/ 产物
```

`lib/` 为构建产物、已被 `.gitignore` 忽略；`npm publish` 会在 `prepublishOnly` 阶段自动构建。

## 发布到 npmjs

```bash
# 首次：登录
npm login

# 在包目录
npm publish
```

`publishConfig` 已设为 `access: public` + `registry: https://registry.npmjs.org/`。

## License

MIT
