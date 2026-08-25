# dsh-plugin-dashboard

DSH 插件管理面板，**嵌入 dsh Web 设置**：Settings → Plugins 新增「插件管理」tab，列出当前 profile 安装的第三方插件、各自已装版本与最新版本（npm registry 或 GitHub tags/HEAD），支持一键升级与卸载。

双面插件形态：node 面在 dsh 进程内注册 host webserver 路由提供数据与操作 API；`dsh.client` 声明的浏览器面在同源 web GUI 里渲染 tab。不依赖 typert remote 装配，也不改 dsh 主仓库。

## 能力

- **版本清单**：读当前 profile 的 `package.json`（dependencies + `dsh.profile.bundles`）、`node_modules/*/package.json`（已装版本）、`pnpm-lock.yaml`（github 安装解析到的 40 位 commit）。
- **最新版本**：全部走 dsh 进程自带的 node 运行时（`fetch`，零子进程）——npm 包查询 registry 的 `/<pkg>/latest`（dist-tag `latest`，尊重 `npm_config_registry`）；github 安装（`github:user/repo`）查 GitHub REST API `/tags` + `/commits/HEAD`，取最高 semver tag（无 tag 用 HEAD）；支持 `GITHUB_TOKEN` 环境变量提额；远端 4xx/不可达 → 该条目降级为「未知」并显示原因，不影响其它条目。
- **升级**：preview 先展示 当前→目标 / 新 specifier / 可复制命令；应用时备份 `package.json`（`.dshbak-*`）、改写 specifier（npm 保 range 风格 `^`/`~`；git 包 pin 到 `#<tag>` 或 `#<commit>`）、经 **`ctx.subprocess`** 跑 `pnpm install`（bounded collect 输出），失败自动回滚。
- **卸载**：从 `dependencies`（`ctx.subprocess` 跑 `pnpm remove`）与 `dsh.profile.bundles` 中一并移除；**core 包（`@deepseek-ai/*`、`@deepseek-harness-tui/*`）拒绝卸载**；未知包报错；同样带备份与失败回滚。
- **stale 与并发**：升级前对当前文件重新计算，counts 与 staged 不一致拒绝；升级/卸载串行执行。
- **安全护栏**：只操作本 profile 的 package.json；core 卸载被硬拒绝；`pnpm install` 失败恢复原文件。

## 安装

作为 profile bundle 挂载。**先停掉正在运行的 dsh，再装**——运行期间改 profile 的 `node_modules` 会让进程读到残缺的依赖树。

```bash
cd ~/.dsh/profiles/<你的 profile>          # 例如 web
pnpm add github:mtaech/dsh-plugin-dashboard
```

`lib/` 已随仓库提交，装完即可用，无需本地构建。然后在 profile 的 `package.json` 把它加进 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-browser-tool", "dsh-plugin-dashboard"]
    }
  }
}
```

重启 dsh，Web 设置 → Plugins 出现「插件管理」tab。验证：

```bash
dsh --profile <你的 profile> --dump-config | grep dsh-plugin-dashboard
```

### 工作原理

- **node 面**（`exports "."`）：cordis 插件，注入 dsh 原生的 `webServer` + `subprocess` 服务——`ctx.webServer.register` 挂 `prefix` 路由 `/plugins/dsh-plugin-dashboard/api`（`/list`、`/upgrade`、`/uninstall`），**零裸 `child_process`**：命令执行全部经 `ctx.subprocess.spawn`（树级终止、bounded collect），版本查询用 node 运行时自带 `fetch`（dsh 的 node，无额外进程）。dsh 进程的 cwd 就是 profile 目录，所有读写都针对它。
- **浏览器面**（`exports "./client"`）：esbuild 打包成 `window.__ModuleLoader__.load({ id, factory })` lazy-CJS factory（脚本 `scripts/build-client.mjs`）。**ModuleLoader 契约有三个硬约束**：factory 只接收 `require` 且必须 `return module.exports`（`<script>` 环境无 module/exports，需在 factory 体内自声明 `var module = { exports: {} }; var exports = module.exports;`）；entry 导出需 `treeShaking: false` 防止 `export const inject` 被内联删除；模块必须真实 `export const inject`（声明服务注入，运行时经此拿 `ctx.slots`）。组件用 `React.createElement` 手写（零 JSX）；`react` 及 `@deepseek-ai/*` 全部 external，从平台模块表解析；`dsh.client.inject` 元数据同时提供给 shell 的注入装配。
- **client→host 通信**：浏览器直接 `fetch` 同源 `/plugins/dsh-plugin-dashboard/api/*`——走 `ctx.webServer` 路由，不依赖 typert Remote 装配（那条路需要进 dsh 主仓库 `api/remotes` 静态登记）。

### 配置（均可选，环境变量优先）

| 环境变量 | 说明 |
| --- | --- |
| `DSH_PLUGIN_DASHBOARD_PROFILE_DIR` | 覆盖 profile 目录（默认 `process.cwd()`，即 dsh 运行的 profile） |
| `DSH_PROFILES_ROOT` | 仅供测试/独立调试时指定 profiles 根 |

## 行为细节与限制

- **卸载语义**：`dependencies` 条目走 `pnpm remove`（改 deps + lockfile + node_modules），随后从 `dsh.profile.bundles` 剔除同名挂载；仅挂载而未声明依赖的条目（如某些 host 包）只剔除 bundles。卸载/升级完成后都需要**重启 dsh** 生效，UI 会提示。
- **升级不会静默覆盖**：staged preview 计数与 apply 时对 live 文件重算结果不一致 → 报 stale 让用户重新 preview；只是行号或无关内容变化但 counts 未变 → 跟随新内容应用（与 omp ast_edit 同一语义）。
- **npm 最新版本以 dist-tag `latest` 为基准**；本地 `npm` 配的 registry（如镜像）即查询源。
- **git 包判定**：以 lock 里解析的 commit 与远端 tag/HEAD commit 比较；安装当时无 tag 的仓库升级会 pin 到新 HEAD。
- **core 保护**：`@deepseek-ai/*`、`@deepseek-harness-tui/*` 不可卸载（防止拆掉 dsh-base 这类地基）；tab 上也不显示卸载按钮。
- **爆发面**：卸载/升级执行期间 dsh 若继续运行，node_modules 会短暂不一致——UI 顶部有运行警告条，仍建议先停 dsh。

## 开发

```bash
npm run build      # tsc（node 面）→ lib/ + esbuild（浏览器面）→ lib/client.cjs
npm run check      # tsc --noEmit
bun test           # 32 项：semver/profile/upgrade + host 插件路由全链路（fake webServer + pnpm shim）
npm run smoke      # fixture 路由全链路 + client.cjs 形态 + 真实 web profile（容错）
```

依赖安装注意：`@deepseek-ai/*` 类型包均声明为 devDependencies（peer 冲突时统一对齐到同一 rc 版本，见 [package.json](./package.json)）；esbuild 的 postinstall 被 npm 11 拦截时手动 `node node_modules/esbuild/install.js`。

## 与其它 dsh 设置项的边界

dsh 自带「Plugin list」（`ui-settings-plugin-inventory`，Loader 树只读清单）与「Plugin configuration」（`ui-settings-plugins`，settings namespace 配置编辑器）两个 tab；本面板补的是**第三方包维度**：版本对比、升级、卸载——三者互补，本包不改动它们。

## 许可

[MIT](./LICENSE) © 画野 (mtaech)