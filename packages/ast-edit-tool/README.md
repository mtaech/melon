# dsh-ast-edit-tool

DSH（DeepSeek Harness）结构化代码编辑工具包：用 ast-grep 对文件/目录/glob 做 AST 感知的语义改写，先在内存里 staging 预览，确认后才落盘。核心语义从 [oh-my-pi](https://github.com/omp) 的 ast_edit 工具迁移而来，保留「preview 先行 → stagedId → apply/reject」三段式流程与 stale 防护。

## 能力

- **AST 结构匹配，不是文本替换**：模式用 `$NAME` / `$_` / `$$$NAME` 元变量（大写、整节点），`pat` 里的捕获按名称替换进 `out`；空 `out` 删除匹配节点。`foo($A, $B)` → `bar($B, $A)`、`foo($$$ARGS)` → `baz($$$ARGS)` 都能正确展开。
- **preview / apply / reject 三段式**：
  - `preview`（默认）——在临时镜像里跑完整改写，返回逐条 `-行:列 before` / `+行:列 after` diff 与 stagedId，**不动任何真实文件**；
  - `apply`——对**当前**文件内容重新计算，totals + 逐文件 counts 与 preview 完全一致才写盘（stale 直接报错，不静默覆盖）；
  - `reject`——丢弃 staged 提案。
- **语言自推断**：按扩展名推断（js/ts/tsx/jsx/py/rs/go/java/c/cpp/cs/rb/php/…），一个 op 跑混合语言目录，规则在某个语言编译不过就只跳过该语言文件（ast-grep 原生行为）。
- **多规则累积**：多个 op 按 pattern 字符串排序后依次应用（与 omp 一致）；单 op 内重叠替换是硬错误（`Overlapping replacements detected`）。
- **预览零副作用 + 原子落盘**：所有 ast-grep 调用只打在 `os.tmpdir()` 的临时镜像上；apply 全量算完一次性写回，中途失败不会留下半套 diff。
- **文件收集**：目录递归（含隐藏文件、跳过 `.git`/`node_modules`）、glob、`.gitignore` 尊重；`maxFiles` 上限（默认 1000，超出报 `Limit reached; narrow paths.`）。

## 工具形态（LLM 视角）

```
ast_edit ops:[{pat:"foo($A)", out:"bar($A)"}] paths:["src/**/*.ts"]
→ Staged as a proposal — files NOT modified yet.
  [src/a.ts]
  -3:6 const r = foo(1)
  +3:6 const r = bar(1)
  1 replacements in 1 files.  stagedId:"a1b2c3d4e5f6"

ast_edit action:"apply" stagedId:"a1b2c3d4e5f6"
→ Applied 1 replacements in 1 files.

ast_edit action:"reject" stagedId:"a1b2c3d4e5f6"
→ Discarded staged rewrite; files unchanged.
```

## 安装

作为 DSH profile 的 bundle 挂载。**先停掉正在运行的 dsh，再装** —— 在服务运行期间改它的 `node_modules` 会让运行中的进程读到残缺的依赖树。

```bash
cd ~/.dsh/profiles/<你的 profile>          # 例如 web
dsh plugin --profile <你的 profile> add dsh-ast-edit-tool
```

从 npm 安装，`lib/` 已随包发布，装完即可用，无需本地构建。

然后在该 profile 的 `package.json` 里把它加进 `dsh.profile.bundles`（顺序放最后即可）：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-ast-edit-tool"]
    }
  }
}
```

引擎依赖 `@ast-grep/cli` 的预编译二进制，pnpm 默认会跳过它的 postinstall（负责把平台二进制复制到包根），需在 profile 的 `pnpm-workspace.yaml` 里放行：

```yaml
allowBuilds:
  "@ast-grep/cli": true
```

**postinstall 被拦也不影响功能**：二进制解析器会退回读取平台包自身的 `ast-grep` 可执行文件（`@ast-grep/cli-linux-x64-gnu` 等 optionalDependencies 直接携带 ELF），只是最好放行以走主路径。若你系统里已有 ast-grep，也可以用 `DSH_AST_GREP_BINARY` 环境变量或配置块指定，跳过包内二进制。

重启 dsh 后 `ast_edit` 工具即出现在工具列表中。验证：

```bash
dsh --profile <你的 profile> --dump-config | grep dsh-ast-edit-tool
```

### 关于依赖

`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 声明为 **peerDependencies 而非 dependencies**——DSH 通过 `~/.dsh/profiles/node_modules/@deepseek-ai/` 的符号链接农场把宿主运行时暴露给插件，写进 `dependencies` 会在 profile 里装第二份实体拷贝，`dsh-tools` 的调度器挂在模块内 `Symbol()` 上，跨实例读取得到 `undefined`，**所有工具调用都会死在 `scheduler.prepare()`**。

### 配置（均可选）

| 键 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `DSH_AST_EDIT_ENABLED` | `true` | `0` 时工具不注册 |
| `maxFiles` | `DSH_AST_MAX_FILES` | `1000` | 文件收集上限，超出报 `Limit reached; narrow paths.` |
| `maxRenderChanges` | `DSH_AST_MAX_RENDER` | `500` | 预览渲染的 diff 条数上限 |
| `binaryPath` | `DSH_AST_GREP_BINARY` | 空 | 指定外部 ast-grep 可执行文件 |

配置块是扁平结构，直接对应 `astEdit` 的字段；环境变量优先。

## 行为细节与已知差异

- **stale 判定**：apply 时对当前文件重新跑一遍（临时镜像），逐文件 counts + totals 与 staged 完全一致才写盘。语义与 omp 一致：**只是行号/无关内容变了但 counts 没变 → 跟随新内容应用**；counts 变了 → 报 stale 让模型重新 preview。
- **删除节点保留行**：空 `out` 删除节点本身，语句行残留的空行由 ast-grep 原生行为决定（不会帮你额外清理空白行）。
- **identity 改写不算替换**：`out` 与原文本一致时不计入 `totalReplacements`，文件不落盘。
- **`.gitignore` 是近似实现**：从入口目录向上逐级收集到工作目录，模式拼接进一个 matcher；深层 `.gitignore` 覆盖上层 negate 的边界情况可能与 git 不完全一致。
- **语法错误文件静默跳过**：解析失败/无支持语言的文件由 ast-grep 直接跳过，不报 parseErrors（omp 原生会报；CLI 面不暴露该信号，这是与 omp 的已知差异）。
- **重叠替换**：同一 op 在同一文件内产生重叠匹配→硬错误 `Overlapping replacements detected … refine pattern to avoid ambiguous edits`（与 omp 一致）。跨 op 的重叠天然不存在（op 依次作用于前一 op 的结果）。
- **line/column**：`changes` 里是 1-based（人类可读）；diff 渲染 `-行:列` / `+行:列`。
- **stagedId**：10 分钟过期、每会话独立、全局限 50 条（最旧淘汰）。apply/reject 只认本会话的 stagedId。
- **并发**：preview 声明 `isConcurrencySafe`（可与其他工具并行）；apply/reject 互斥串行。
- **钩子行为**：文件写入走本插件自己的 `fs.writeFile`，不经 `fs/write-intent` 事件门——若你的 profile 组合了 `dsh-fs-observation-policy` 这类读改门，ast_edit 的落盘不会触发它的 fs 事件（与 `str_replace_editor` 直接改写同一量级）。

## 开发

```bash
npm run check      # tsc --noEmit
npm run build      # tsc → lib/
bun test           # 单元测试（engine/files/staging/plugin 共 26 项）
npm run smoke      # 构建后跑真实 ast-grep 二进制全链路（preview→apply→stale→reject）
```

## 与 omp 的差异

- omp 走 `xd://resolve` / `xd://reject` 设备协议 + 原生 Rust ast-grep（`pi-natives`）；dsh 无 xd 设备，改为单工具 `action` 三态 + staging 内存表，stale 判定与渲染保持同构。
- 引擎用的是打包的 `ast-grep` CLI（全语言），而非 `@ast-grep/napi`（该 npm 包只带 ts/tsx/js/jsx/html/css 六种语言，其余语言需自行注册 grammar dylib，不可移植）。
- omp 渲染两种模式（hashline/plain）；这里只做 plain 行:列模式。
- parseErrors 细粒度信息（哪个语言编译失败）在 CLI 面拿不到，静默跳过，见「已知差异」。

## 许可

[MIT](./LICENSE) © 画野 (mtaech)

改写流程与语义移植自 oh-my-pi 的 ast_edit / ast-grep 工具。