# Material You 皮肤 · DeepSeek Harness

一套遵循 **Google Material You / Material 3 (M3)** 设计规范的 DeepSeek Harness 皮肤。
配色由 **Material Color Utilities 的 HCT 算法** 从种子色推导成色调色板（tonal palette），
字体采用 **Maple Mono NF CN**（带 Nerd Font + 中文的等宽字体）。

---

## 1. 设计要点

| 维度 | 取值 |
| --- | --- |
| 种子色 (seed) | `#4666FA`（HCT 色相 296，tone 50 处 chroma 60，偏靛蓝/紫） |
| 调色板模型 | HCT（Hue–Chroma–Tone），tone 0–100，非 HSV/HSL |
| 色板数量 | 5 条：primary / secondary / tertiary / neutral / neutral-variant |
| 字体 | Maple Mono NF CN（family name `"Maple Mono NF CN"`，经 System.Drawing 校验） |
| 字重 | 100–800（Thin…ExtraBold）+ 全套斜体 |
| 动效 | M3 emphasized/standard 缓动，支持 `prefers-reduced-motion` |
| 形状 | M3 圆角体系（4/8/12/16/28/full px） |

## 2. 种子色与 HCT 色调色板

Material You 的"动态取色"本质：从种子色提取 **色相 (hue)** 与 **彩度 (chroma)**，
再沿 **色调 (tone，即明度 L*)** 轴生成一条 13 级色板。本皮肤种子 `#4666FA` 推导出：

### primary（主色，chroma 60）

| tone | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 值 | `#1a192e` | `#2b2c58` | `#3a3f86` | `#4a54b7` | `#676cd3` | `#8486f0` | `#a6a3f5` | `#c6c0f9` | `#e3dffc` | `#f1effe` |

### neutral（中性色，用于 surface，chroma 4）

| tone | 4 | 6 | 10 | 12 | 17 | 22 | 40 | 80 | 90 | 94 | 98 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 值 | `#0c0e15` | `#121319` | `#1a1b21` | `#1e1f25` | `#282a2f` | `#33353a` | `#5c5e65` | `#c4c6ce` | `#e0e2ea` | `#eceef5` | `#f8f9ff` |

### neutral-variant（surface-variant / outline，chroma 8）

| tone | 30 | 40 | 50 | 60 | 70 | 80 | 90 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 值 | `#454652` | `#5c5d6b` | `#757684` | `#8f909e` | `#a9aab9` | `#c4c5d4` | `#e0e1f1` |

### secondary（次要，chroma 16）与 tertiary（第三，chroma 20）

- secondary：`#5e5c76`(40) / `#c7c5d4`(80)
- tertiary：`#775843`(40) / `#d7c3b7`(80)

> 完整色值见 `src/palette.css`。生成算法（HCT → sRGB）与 Material Color Utilities
> 一致：`#6750A4` 用同算法可复现官方 baseline 色板（primary-40 = `#6750A4`），
> 验证了实现正确性。

## 3. M3 颜色角色 → DSH token 映射

DSH 皮肤通过覆盖 `--dsw-alias-*` / `--dsw-specific-*` 语义 token 生效
（详见 `docs/dsh-skin-development.md`）。下面是核心映射（L=浅色 / D=深色）：

| DSH token | M3 角色 | 浅色 (light) | 深色 (dark) |
| --- | --- | --- | --- |
| `--dsw-alias-bg-base` | surface | `#f8f9ff` | `#121319` |
| `--dsw-alias-bg-layer-1` | surface-container | `#eceef5` | `#1e1f25` |
| `--dsw-alias-bg-layer-2` | surface-container-high | `#e6e8ef` | `#282a2f` |
| `--dsw-alias-bg-layer-3` | surface-container-highest | `#e0e2ea` | `#33353a` |
| `--dsw-alias-bg-overlay` | surface-variant | `#e0e1f1` | `#37393f` |
| `--dsw-alias-brand-primary` | primary | `#4a54b7` | `#c6c0f9` |
| `--dsw-alias-label-primary` | on-surface | `#1a1b21` | `#e0e2ea` |
| `--dsw-alias-label-secondary` | on-surface-variant | `#454652` | `#c4c5d4` |
| `--dsw-alias-label-tertiary` | on-surface-variant | `#454652` | `#c4c5d4` |
| `--dsw-alias-label-caption` | outline | `#5c5d6b` | `#a9aab9` |
| `--dsw-alias-border-l2` | outline-variant | `rgba(26,27,33,.12)` | `rgba(224,226,234,.14)` |
| `--dsw-alias-interactive-bg-hover` | state layer (8%) | `rgba(74,84,183,.08)` | `rgba(198,192,249,.08)` |
| `--dsw-alias-button-primary-fill` | primary | `#4a54b7` | `#c6c0f9` |
| `--dsw-alias-state-error-primary` | error | `#ba1a1a` | `#ffb4ab` |
| `--dsw-specific-sidebar-fill` | surface-dim | `#f1f3fb` | `#0c0e15` |
| `--dsw-specific-sidebar-nav-item-active` | secondary-container | `#e3dffc` | `#3a3f86` |

完整的 `--dsw-alias-*` 覆盖清单（约 80 个 token × 双外观）在 `src/tokens.mjs`。

> M3 关键语义：surface 用 **neutral** 色板，surface-variant/outline 用 **neutral-variant**，
> primary/secondary/tertiary 独立；深浅两套由"同 roles、不同 tone"天然对应
> （如 primary：light=tone40，dark=tone80）。

## 4. 排印（Maple Mono NF CN）

M3 官方用 Roboto（无衬线），但本皮肤应需求改用 Maple Mono NF CN（等宽）。保留了 M3 的
**字号 / 字重 / 行高 / 字距节奏**，字重按 M3 的 400/500/700 映射到 Maple Mono 的
Regular/Medium/Bold：

| M3 角色 | 字号/行高 | 字重 |
| --- | --- | --- |
| Display Large | 57/64 | 400 |
| Headline Large | 32/40 | 400 |
| Title Large | 22/28 | 400 |
| Title Medium | 16/24 | 500 |
| Body Large | 16/24 | 400 |
| Body Medium | 14/20 | 400 |
| Label Large | 14/20 | 500 |

完整 type scale 与 `--m3-typescale-*` token 见 `src/fonts.css`。

### 字体加载（自托管）

已随包自带 **Regular 字重** woff2（`fonts/MapleMono-NF-CN-Regular.woff2`，约 6.1MB），
`src/fonts.css` 里启用 `@font-face`（`font-weight: 100 800` 声明覆盖全部字重，
未打包的 Medium/Bold 走浏览器合成加粗或系统已安装字体回退）：

```css
@font-face {
  font-family: 'Maple Mono NF CN';
  font-style: normal;
  font-weight: 100 800;
  src: url('../fonts/MapleMono-NF-CN-Regular.woff2') format('woff2');
  font-display: swap;
}
```

> 如需更忠实的 Medium/Bold 字重，把对应 TTF 用 fontTools 转 woff2 放入 `fonts/`
> 并补对应 `@font-face` 规则（每份约 6MB）。

## 5. 文件结构

```
theme-material-you/
├── package.json        # dsh.bundle.patch + dsh.client 声明（标准插件形态）
├── cordis.patch.yml    # 自带 patch：insert 皮肤行（bundle 层）
├── README.md           # 本文档
├── fonts/              # 自托管 Maple Mono Regular woff2（6.1MB）
├── src/                # 源文件
│   ├── tokens.mjs      # M3 色调色板 → DSH --dsw-* 覆盖（source of truth）
│   ├── fonts.css       # Maple Mono @font-face + M3 type scale / shape / motion token
│   ├── palette.css     # 原始 HCT 色板（参考/文档）
│   ├── client.js       # 源版插件体（apply/overrideTokens/register/注入 CSS）
│   ├── client.d.ts
│   └── index.js / index.d.ts   # 源版 host 入口（重新构建时用）
└── lib/                # 构建产物（DSH 实际加载）
    ├── index.js        # host 侧 no-op 插件入口（exports: name/apply）
    ├── index.d.ts
    └── client.js       # 浏览器侧 bundle（__ModuleLoader__.load 格式，内联 tokens+CSS）

```

## 6. 插件形态（标准模板对齐）

对照社区标准模板（`Nagi-ovo/dsh-ads`）的插件形态：

- **`dsh.bundle.patch: "./cordis.patch.yml"`** —— 声明本包是一个 bundle patch 层；
  `dsh plugin add` 后会自动把包名加进 profile 的 `dsh.profile.bundles`，无需手动编辑 profile。
- **自带 `cordis.patch.yml`** —— 用 `insert` 把皮肤行挂进加载列表：
  ```yaml
  - insert:
      - id: ui-skin-material-you
        name: '@deepseek-ai/dsh-skin-material-you'
  ```
- **`exports["./client"]` 为简单字符串**，指向 `lib/client.js` 浏览器 bundle。

### 两层 inject（易混淆，务必分清）

| 位置 | 内容 | 作用 |
| --- | --- | --- |
| `package.json` 的 `dsh.client.inject` | **包名**数组 | 构建 `window.__DSH_BOOT__` 引导图的包级加载顺序 |
| `lib/client.js` 的 `exports.inject` | **服务名**数组 | 浏览器 cordis 服务依赖（fiber 激活前等待） |

> ⚠️ 二者不能混用：`exports.inject` 若写成包名，浏览器 cordis 会永远等不到该
> "服务"，条目卡 `pending`，`web boot` 抛 `did not activate` 错误。
> 本皮肤 `exports.inject = ['theme']`（`theme` 是 ui-theme 提供的服务名）。

## 7. 安装到 DSH

```bash
# 从本仓库目录安装（file: 依赖；也支持发布到 npm 后直接加包名）
dsh plugin --profile web add "file:E:/Dev/Code/dsh-material/theme-material-you"
```

安装后：
- 包被自动加入 `profiles/web/package.json` 的 `dsh.profile.bundles`
- 自带 `cordis.patch.yml` 把 `ui-skin-material-you` 行插进加载列表
- 重启 `dsh web` 生效：`system` 偏好下两种外观均为 Material You 配色；
  设置 → 外观里可选 `material-you-light` / `material-you-dark` 固定主题

卸载：`dsh plugin --profile web remove @deepseek-ai/dsh-skin-material-you`

验证：`dsh --profile web --dump-config` 应看到皮肤行，且标记来源为
`# == @deepseek-ai/dsh-skin-material-you`（bundle 自带 patch 层）。

## 8. 已知限制

- **第三方主题是扩展点不是产品**：DSH 不校验覆盖是否完整；本皮肤已尽量覆盖全部
  `--dsw-alias-*` 与 `--dsw-specific-*`，但若上游新增 token 需同步补。
- **只随包携带 Regular 字重**：Medium/Bold 走浏览器合成或系统字体回退（见 §4）。
- 若要更换种子色，改 `src/tokens.mjs` 里的调色板常量（或重新跑 HCT 生成器），
  并同步 `src/palette.css`。

## 9. 换种子色

想换主题色，改步骤：

1. 用 HCT 生成器（material-color-utilities 或 `src/palette.css` 头部的注释算法）从新种子
   生成 primary/secondary/tertiary/neutral/neutral-variant 五条色板。
2. 替换 `src/tokens.mjs` 里 `NEUTRAL`/`VARIANT`/`PRIMARY`/`SECONDARY`/`TERTIARY`
   常量与 `ERROR`。
3. 同步 `src/palette.css` 的参考值。
