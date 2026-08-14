/**
 * Material You / Material 3 token maps for DeepSeek Harness.
 *
 * Seed color: #4666FA  (HCT hue ~296, chroma 60 at tone 50)
 * Every value below is a Material 3 color ROLE resolved through an HCT
 * tonal palette (tones 0..100). See palette.css for the raw ramp and
 * README.md for the role -> --dsw-* mapping rationale.
 *
 * Shape: { light: string, dark: string } per DSH ThemeTokenOverrides.
 */

// ---- Material 3 tonal ramps (HCT) -----------------------------------------
const NEUTRAL = {
  n0: "#000000", n4: "#0c0e15", n6: "#121319", n10: "#1a1b21", n12: "#1e1f25",
  n17: "#282a2f", n20: "#2f3036", n22: "#33353a", n24: "#37393f", n30: "#45474d",
  n35: "#515258", n40: "#5c5e65", n50: "#75777e", n60: "#8f9097", n70: "#a9abb2",
  n80: "#c4c6ce", n87: "#d8dae1", n90: "#e0e2ea", n92: "#e6e8ef", n94: "#eceef5",
  n95: "#eff0f8", n96: "#f1f3fb", n98: "#f8f9ff", n99: "#fbfcff", n100: "#ffffff",
};
const VARIANT = {
  v10: "#191b26", v20: "#2e303b", v30: "#454652", v40: "#5c5d6b", v50: "#757684",
  v60: "#8f909e", v70: "#a9aab9", v80: "#c4c5d4", v90: "#e0e1f1", v95: "#eff0ff",
  v98: "#f8f9ff",
};
const PRIMARY = {
  p10: "#1a192e", p20: "#2b2c58", p30: "#3a3f86", p40: "#4a54b7", p50: "#676cd3",
  p60: "#8486f0", p70: "#a6a3f5", p80: "#c6c0f9", p90: "#e3dffc", p95: "#f1effe",
  p99: "#fcfcff",
};
const SECONDARY = { s30: "#474557", s40: "#5e5c76", s50: "#77748f", s80: "#c7c5d4", s90: "#e3e2e9" };
const TERTIARY = { t40: "#775843", t80: "#d7c3b7", t90: "#ebe0da" };
const ERROR = {
  light: "#ba1a1a", lightContainer: "#ffdad6", lightOnContainer: "#410002",
  dark: "#ffb4ab", darkContainer: "#93000a", darkOnContainer: "#690005",
};

// ---- M3 color roles, resolved to DSH token names (both schemes) -----------
// Each entry: [dsToken, lightValue, darkValue]
const L = "light", D = "dark";

// 1) Surfaces / backgrounds
const bg = (l, d) => ({ light: l, dark: d });

export const materialYouTokens = {
  // Surface elevation hierarchy (M3 surface-container-*)
  "--dsw-alias-bg-base":     bg(NEUTRAL.n98, NEUTRAL.n6),
  "--dsw-alias-bg-layer-1":  bg(NEUTRAL.n94, NEUTRAL.n12),
  "--dsw-alias-bg-layer-2":  bg(NEUTRAL.n92, NEUTRAL.n17),
  "--dsw-alias-bg-layer-3":  bg(NEUTRAL.n90, NEUTRAL.n22),
  "--dsw-alias-bg-overlay":  bg(VARIANT.v90, NEUTRAL.n24),
  "--dsw-alias-bg-module-platform": bg(NEUTRAL.n96, NEUTRAL.n22),
  "--dsw-alias-bg-multi-select":   bg(NEUTRAL.n96, NEUTRAL.n12),
  // Scrims (M3 scrim #000, tones from opacity)
  "--dsw-alias-bg-mask-1": bg("rgba(0,0,0,0.32)", "rgba(0,0,0,0.56)"),
  "--dsw-alias-bg-mask-2": bg("rgba(0,0,0,0.12)", "rgba(0,0,0,0.20)"),
  "--dsw-alias-bg-mask-3": bg("rgba(0,0,0,0.48)", "rgba(0,0,0,0.64)"),
  "--dsw-alias-bg-mask-photo": bg("rgba(0,0,0,0.88)", "rgba(0,0,0,0.92)"),
  "--dsw-alias-bg-mask-drop": bg("rgba(236,238,245,0.72)", "rgba(30,31,37,0.72)"),
  "--dsw-alias-bg-skeleton": bg("rgba(26,27,33,0.06)", "rgba(224,226,234,0.08)"),

  // 2) Border / outline (M3 outline & outline-variant)
  "--dsw-alias-border-l1": bg("rgba(26,27,33,0.06)", "rgba(224,226,234,0.08)"),
  "--dsw-alias-border-l2": bg("rgba(26,27,33,0.12)", "rgba(224,226,234,0.14)"),
  "--dsw-alias-border-l3": bg("rgba(26,27,33,0.16)", "rgba(224,226,234,0.20)"),
  "--dsw-alias-border-l4": bg("rgba(26,27,33,0.24)", "rgba(224,226,234,0.28)"),
  "--dsw-alias-border-inverted": bg("rgba(224,226,234,0.10)", "rgba(26,27,33,0.10)"),
  "--dsw-alias-border-inverted2": bg("rgba(224,226,234,0.14)", "rgba(26,27,33,0.14)"),

  // 3) Brand / primary
  "--dsw-alias-brand-primary": bg(PRIMARY.p40, PRIMARY.p80),
  "--dsw-alias-brand-primary-invert": bg("#ffffff", PRIMARY.p20),
  "--dsw-alias-brand-text": bg(PRIMARY.p40, PRIMARY.p80),

  // 4) Labels (on-surface scale)
  "--dsw-alias-label-primary": bg(NEUTRAL.n10, NEUTRAL.n90),
  "--dsw-alias-label-secondary": bg(VARIANT.v30, VARIANT.v80),
  "--dsw-alias-label-tertiary": bg(VARIANT.v30, VARIANT.v80),
  "--dsw-alias-label-caption": bg(VARIANT.v40, VARIANT.v70),
  "--dsw-alias-label-dimmed": bg(NEUTRAL.n80, NEUTRAL.n40),
  "--dsw-alias-label-primary-dimmed": bg(NEUTRAL.n20, NEUTRAL.n95),
  "--dsw-alias-label-primary-bluish": bg(PRIMARY.p30, PRIMARY.p90),
  "--dsw-alias-label-primary-foreground": bg("#ffffff", PRIMARY.p20),
  "--dsw-alias-label-primary-inverted": bg("#ffffff", PRIMARY.p20),

  // 5) Interactive / state layers (M3 state layer 8%/12%)
  "--dsw-alias-interactive-bg-hover": bg("rgba(74,84,183,0.08)", "rgba(198,192,249,0.08)"),
  "--dsw-alias-interactive-bg-active": bg("rgba(74,84,183,0.12)", "rgba(198,192,249,0.14)"),
  "--dsw-alias-interactive-bg-hover-accent": bg("rgba(74,84,183,0.12)", "rgba(198,192,249,0.20)"),
  "--dsw-alias-interactive-bg-hover-solid": bg(NEUTRAL.n96, NEUTRAL.n17),
  "--dsw-alias-interactive-bg-hover-danger": bg("rgba(186,26,26,0.08)", "rgba(255,180,171,0.12)"),

  // 6) Buttons (M3 tonal button)
  "--dsw-alias-button-primary-fill": bg(PRIMARY.p40, PRIMARY.p80),
  "--dsw-alias-button-primary-hover": bg(PRIMARY.p50, PRIMARY.p70),
  "--dsw-alias-button-primary-dimmed": bg(NEUTRAL.n94, NEUTRAL.n22),
  "--dsw-alias-button-info-fill": bg(PRIMARY.p40, PRIMARY.p80),
  "--dsw-alias-button-info-hover": bg(PRIMARY.p50, PRIMARY.p70),
  "--dsw-alias-button-contrast-fill": bg(NEUTRAL.n10, NEUTRAL.n90),
  "--dsw-alias-button-elevated-fill": bg(NEUTRAL.n100, NEUTRAL.n24),
  "--dsw-alias-button-floating-fill": bg(NEUTRAL.n98, NEUTRAL.n22),
  "--dsw-alias-button-floating-hover": bg(NEUTRAL.n95, NEUTRAL.n30),
  "--dsw-alias-button-ghost-active-fill": bg(PRIMARY.p90, PRIMARY.p30),
  "--dsw-alias-button-ghost-active-hover": bg(VARIANT.v95, NEUTRAL.n24),
  "--dsw-alias-button-ghost-active-border": bg(VARIANT.v50, VARIANT.v60),
  "--dsw-alias-button-tool-bar-fill": bg("rgba(92,93,107,0.4)", "rgba(224,226,234,0.4)"),
  "--dsw-alias-button-tool-bar-fill-invisible": bg("rgba(92,93,107,0.24)", "rgba(224,226,234,0.24)"),
  "--dsw-alias-button-tool-bar-hover": bg("rgba(92,93,107,0.5)", "rgba(224,226,234,0.5)"),

  // 7) Markdown surfaces
  "--dsw-alias-markdown-code-block": bg(NEUTRAL.n94, NEUTRAL.n12),
  "--dsw-alias-markdown-code-block-banner": bg(NEUTRAL.n96, NEUTRAL.n17),
  "--dsw-alias-markdown-inline-code": bg(VARIANT.v95, NEUTRAL.n22),
  "--dsw-alias-markdown-code-segment-selected": bg(NEUTRAL.n100, NEUTRAL.n30),
  "--dsw-alias-markdown-code-segment-unselected": bg(NEUTRAL.n96, NEUTRAL.n22),
  "--dsw-alias-markdown-citation": bg(VARIANT.v95, NEUTRAL.n22),
  "--dsw-alias-markdown-tag": bg(VARIANT.v90, NEUTRAL.n24),
  "--dsw-alias-markdown-placeholder": bg(NEUTRAL.n96, NEUTRAL.n22),

  // 8) Scrollbars
  "--dsw-alias-scrollbar-bg-l1": bg(NEUTRAL.n80, NEUTRAL.n40),
  "--dsw-alias-scrollbar-bg-l2": bg(NEUTRAL.n80, NEUTRAL.n35),
  "--dsw-alias-scrollbar-hover-l1": bg(NEUTRAL.n70, NEUTRAL.n35),
  "--dsw-alias-scrollbar-hover-l2": bg(NEUTRAL.n70, NEUTRAL.n30),

  // 9) State (M3 error / success / warning; tertiary for business)
  "--dsw-alias-state-error-primary": bg(ERROR.light, ERROR.dark),
  "--dsw-alias-state-error-secondary": bg(ERROR.light, ERROR.dark),
  "--dsw-alias-state-success-primary": bg("#3b6939", "#86d484"),
  "--dsw-alias-state-success-secondary": bg("#4caf50", "#66bb6a"),
  "--dsw-alias-state-success-tertiary": bg("#d0e8d0", "#2b3d2b"),
  "--dsw-alias-state-warn-primary": bg("#8a5a00", "#ffb958"),
  "--dsw-alias-state-warn-secondary": bg("#a87000", "#ffb958"),
  "--dsw-alias-state-warn-tertiary": bg("#f2e0c0", "#3d3220"),
  "--dsw-alias-state-warn-label": bg("#8a5a00", "#ffb958"),
  "--dsw-alias-state-business-primary": bg(PRIMARY.p40, PRIMARY.p80),
  "--dsw-alias-state-business-tertiary": bg(PRIMARY.p90, PRIMARY.p30),

  // 10) Toast / tooltip (inverse-surface)
  "--dsw-alias-toast-bg": bg(NEUTRAL.n20, NEUTRAL.n80),
  "--dsw-alias-tooltip-bg": bg(NEUTRAL.n20, NEUTRAL.n80),

  // 11) Component-specific
  "--dsw-specific-sidebar-fill": bg(NEUTRAL.n96, NEUTRAL.n4),
  "--dsw-specific-sidebar-nav-item-hover": bg(NEUTRAL.n95, NEUTRAL.n12),
  "--dsw-specific-sidebar-nav-item-active": bg(PRIMARY.p90, PRIMARY.p30),
  "--dsw-specific-sidebar-nav-item-active-accent": bg(PRIMARY.p40, PRIMARY.p80),
  "--dsw-specific-bubble": bg(PRIMARY.p95, PRIMARY.p30),
  "--dsw-specific-bubble-highlight": bg(PRIMARY.p80, PRIMARY.p40),
  "--dsw-specific-input-major": bg(NEUTRAL.n100, NEUTRAL.n22),
  "--dsw-specific-login-input": bg(NEUTRAL.n98, NEUTRAL.n12),
  "--dsw-specific-selector": bg(NEUTRAL.n96, NEUTRAL.n22),
  "--dsw-specific-menu": bg(NEUTRAL.n98, NEUTRAL.n24),
  "--dsw-specific-tip": bg(NEUTRAL.n96, NEUTRAL.n22),
};

export default materialYouTokens;
