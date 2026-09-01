# AGENTS.md

为 DSH（DeepSeek Harness）开发的插件与皮肤单仓库。人读的通用说明、安装与发布命令见 [README.md](README.md)；本文件只写 agent 在这里干活时需要、且容易踩错的点。动手前先读相关包的 `package.json` 与 `README.md`，再看本文件。

## 一个仓库，三种构建方式

五个包，构建方式并不统一，别假设都是 `tsc`。**先看目标包的 `package.json` 的 `scripts`，按它来。**

- **tsc 系**（`src/*.ts`，有 `tsconfig.json`）：`ast-edit-tool`、`browser-tool`（`build` 后再 `copy-assets`）、`plugin-dashboard`（`build` 后再 `build-client` 产出 `lib/client.cjs`）。
- **esbuild 系**（`src/*.js`，无 `tsconfig.json`）：`model-select-plus`、`skin-material-you`，走 `node build.mjs`，直接拼 `window.__ModuleLoader__.load({ id, factory })`。

## `lib/` 是构建产物，不是源码

改代码永远进 `src/`，**不要手改 `lib/`**。`lib/` 在 `.gitignore`，不入版本控制；构建后由 `pnpm --filter <包名> build` 重新产出。

**smoke 加载的是构建产物**（`node scripts/smoke.mjs`），不是断言源码文本——改完 src 先 build 再 smoke。单元测试统一用 `bun test`（bun 跑），**不要**引入 vitest / jest。

## `@deepseek-ai/*` 单一版本源

所有 `@deepseek-ai/*` 必须对齐同一个 rc，混用不同 rc 会因为 cordis 服务实例不同源触发 peer 冲突。**唯一改版本的地方是 `pnpm-workspace.yaml` 的 `catalog:`**：各包 `package.json` 只写 `"catalog:"`，升级只动 catalog 一处。单独改某个包的依赖版本就是 bug。

新 rc 上线前想先对本地 DSH checkout 做类型检查：`node scripts/verify-new-dsh.mjs link`（把 melon 的 `@deepseek-ai` 指向本地 DSH 的 built lib），`restore` 还原。DSH 路径来自 `$DSH_DIR`，默认同级 `deepseek-harness`。

## `tsconfig.base.json` 的路径陷阱

`tsconfig.base.json` 只放共享编译选项。`outDir` / `rootDir` 是路径相对项——在 `extends` 里会相对 base 文件解析，因此**必须留在各包自己的 `tsconfig.json`**。往 base 加任何别的选项都可以，但别把 `outDir` / `rootDir` 挪进去。

## 插件的 host / client 两半

带 Web 界面的插件分两半：

- **host 半**：cordis 插件，走 webServer 路由（见 `plugin-dashboard` 的 `src/host.ts`、`model-select-plus` 的 `src/host.js`）。
- **client 半**：给 web GUI 的浏览器包，用 esbuild 打成 `window.__ModuleLoader__.load({ id, factory })` 形态。`factory` 只拿到 `require`，内部 `module` / `exports` / `require` 绑定在 factory 作用域里；`react` 与 `@deepseek-ai/*` 标为 external。

**新写 Web 插件：照着现成的抄结构**——`plugin-dashboard`（tsc + esbuild 混合）或 `model-select-plus`（纯 JS + esbuild），不要新造一套。皮肤的 hook 是 `ctx.theme.overrideTokens` / `register`，经 `dsh.client.inject` 注入 `@deepseek-ai/dsh-client-ui-theme` 等；开发说明见 `packages/skin-material-you/docs/dsh-skin-development.md`。

## 别碰的东西

- `dsh-desktop/` 是独立仓库（whalenest），恰好放在同级目录，已 gitignore，不要改也别提交。
- `scripts/.verify-state.json` 是 `verify-new-dsh.mjs` 的临时状态，不要手改。

## 提交与发布

- commit message 用中文，参考仓库历史风格。
- 发布：`pnpm --filter <包名> publish --access public`，registry 已锁 npmjs.org（本机默认镜像不影响）。账号开了 2FA，发布需要 OTP。
