# melon

为 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 开发的插件与皮肤单仓库。

## 包

| 包 | 说明 |
|---|---|
| [`dsh-ast-edit-tool`](packages/ast-edit-tool) | agent 工具：基于 ast-grep 的结构化改写，`$NAME` / `$$$ARGS` 元变量，预览-确认两段式 |
| [`dsh-browser-tool`](packages/browser-tool) | agent 工具：驱动 Chromium（headless / CDP 接管 / 本机真实 Chrome via Relay），open-close-run 标签页脚本 API |
| [`dsh-model-select-plus`](packages/model-select-plus) | Web 插件：composer 模型选择弹窗增强——按 provider 分组、推理等级一键切换、搜索过滤、收藏置顶、分组折叠与 Tag 导航，触发按钮显示 供应商/模型 |
| [`dsh-plugin-dashboard`](packages/plugin-dashboard) | Web 设置页：列出 profile 已装第三方插件的当前/最新版本，一键升级与卸载 |
| [`dsh-skin-material-you`](packages/skin-material-you) | 皮肤：Material 3 HCT 色调色板 + Maple Mono NF CN 排印 |

五个包各自独立发版到 npm，安装方式统一：

```bash
dsh plugin --profile <你的 profile> add <包名>
```

## 开发

需要 Node ≥ 20、pnpm 11、bun（跑测试）。

```bash
pnpm install
pnpm build     # 全部包
pnpm check  # tsc --noEmit
pnpm test   # bun test
pnpm smoke     # 真实执行，非测试文件
```

单个包：`pnpm --filter dsh-browser-tool build`。

### 约定

- **`lib/` 是构建产物，不入版本控制**，由各包 `build` 产出、`prepublishOnly` 在发布前重建。
- **`@deepseek-ai/*` 依赖必须整体对齐同一个 rc**，混用不同 rc 会因 cordis 服务实例不同源触发 peer 冲突。版本统一写在 `pnpm-workspace.yaml` 的 `catalog:`，各包只写 `"catalog:"`，升级只改一处。
- **`tsconfig.base.json` 存放共享编译选项**；`outDir` / `rootDir` 是路径相对项，在 `extends` 中会相对 base 文件解析，必须留在各包自己的 `tsconfig.json`。
- 每个包都有 `scripts/smoke.mjs`：真实加载构建产物并驱动主流程，而不是断言源码文本。

## 发布

```bash
pnpm --filter <包名> publish --access public
```

`publishConfig.registry` 已锁 npmjs.org，本机默认 registry 是镜像也不受影响。账号开了 2FA，发布时需要 OTP。

## 许可

MIT
