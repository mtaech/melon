/**
 * Material You / Material 3 token maps for DeepSeek Harness.
 *
 * Seed color: #3B82F6  (HCT hue ~266, chroma 64 at tone 56 — clean tech blue)
 * Every value below is a Material 3 color ROLE resolved through an HCT
 * tonal palette (tones 0..100). See palette.css for the raw ramp and
 * README.md for the role -> --dsw-* mapping rationale.
 *
 * Shape: { light: string, dark: string } per DSH ThemeTokenOverrides.
 *
 * Light-mode surface hierarchy is lifted toward pure white (base #FFFFFF,
 * raised layers at HCT tones 98/96/95) for a bright, clean "blue + white" look.
 * --dsw-specific-sidebar-nav-item-active-accent intentionally uses the
 * primary-container tones (p90/p30): the ask_user_question "Recommended" badge
 * paints its background with this token and its text with
 * --dsw-alias-button-info-fill (p40/p80), so they must contrast.
 */

// ---- Material 3 tonal ramps (HCT, azure seed #3B82F6) ----------------------
const NEUTRAL = {
  n0: "#000000", n4: "#0d0e11", n6: "#121316", n10: "#1b1b1f", n12: "#1f1f23",
  n17: "#292a2d", n20: "#303034", n22: "#343538", n24: "#38393c", n30: "#46464a",
  n35: "#525256", n40: "#5e5e62", n50: "#77777a", n60: "#919094", n70: "#ababaf",
  n80: "#c7c6ca", n87: "#dbd9dd", n90: "#e3e2e6", n92: "#e9e7ec", n94: "#efedf1",
  n95: "#f2f0f4", n96: "#f5f3f7", n98: "#faf8fd", n99: "#fefbff", n100: "#ffffff",
};
const VARIANT = {
  v10: "#191b22", v20: "#2e3038", v30: "#44474f", v40: "#5c5e66", v50: "#75777f",
  v60: "#8e9099", v70: "#a9abb4", v80: "#c4c6d0", v90: "#e1e2ec", v95: "#eff0fa",
  v98: "#f9f9ff",
};
const PRIMARY = {
  p10: "#001a42", p20: "#002e6a", p30: "#004395", p40: "#015ac2", p50: "#3474dd",
  p60: "#538ef9", p70: "#81aaff", p80: "#adc6ff", p90: "#d8e2ff", p95: "#edf0ff",
  p99: "#fefbff",
};
const SECONDARY = { s30: "#394764", s40: "#505e7d", s50: "#697797", s80: "#b8c6ea", s90: "#d8e2ff" };
const TERTIARY = { t40: "#77517c", t80: "#e6b7e9", t90: "#fed6ff" };
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
  // Surface elevation hierarchy (M3 surface-container-*), light lifted white
  "--dsw-alias-bg-base":     bg("#ffffff", NEUTRAL.n6),
  "--dsw-alias-bg-layer-1":  bg(NEUTRAL.n98, NEUTRAL.n12),
  "--dsw-alias-bg-layer-2":  bg(NEUTRAL.n96, NEUTRAL.n17),
  "--dsw-alias-bg-layer-3":  bg(NEUTRAL.n95, NEUTRAL.n22),
  "--dsw-alias-bg-overlay":  bg(VARIANT.v95, NEUTRAL.n24),
  "--dsw-alias-bg-module-platform": bg(NEUTRAL.n99, NEUTRAL.n22),
  "--dsw-alias-bg-multi-select":   bg(NEUTRAL.n99, NEUTRAL.n12),
  // Scrims (M3 scrim #000, tones from opacity)
  "--dsw-alias-bg-mask-1": bg("rgba(0,0,0,0.32)", "rgba(0,0,0,0.56)"),
  "--dsw-alias-bg-mask-2": bg("rgba(0,0,0,0.12)", "rgba(0,0,0,0.20)"),
  "--dsw-alias-bg-mask-3": bg("rgba(0,0,0,0.48)", "rgba(0,0,0,0.64)"),
  "--dsw-alias-bg-mask-photo": bg("rgba(0,0,0,0.88)", "rgba(0,0,0,0.92)"),
  "--dsw-alias-bg-mask-drop": bg("rgba(250,248,253,0.72)", "rgba(31,31,35,0.72)"),
  "--dsw-alias-bg-skeleton": bg("rgba(27,27,31,0.06)", "rgba(227,226,230,0.08)"),

  // 2) Border / outline (M3 outline & outline-variant)
  "--dsw-alias-border-l1": bg("rgba(27,27,31,0.06)", "rgba(227,226,230,0.08)"),
  "--dsw-alias-border-l2": bg("rgba(27,27,31,0.12)", "rgba(227,226,230,0.14)"),
  "--dsw-alias-border-l3": bg("rgba(27,27,31,0.16)", "rgba(227,226,230,0.20)"),
  "--dsw-alias-border-l4": bg("rgba(27,27,31,0.24)", "rgba(227,226,230,0.28)"),
  "--dsw-alias-border-inverted": bg("rgba(227,226,230,0.10)", "rgba(27,27,31,0.10)"),
  "--dsw-alias-border-inverted2": bg("rgba(227,226,230,0.14)", "rgba(27,27,31,0.14)"),

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
  "--dsw-alias-interactive-bg-hover": bg("rgba(1,90,194,0.08)", "rgba(173,198,255,0.08)"),
  "--dsw-alias-interactive-bg-active": bg("rgba(1,90,194,0.12)", "rgba(173,198,255,0.14)"),
  "--dsw-alias-interactive-bg-hover-accent": bg("rgba(1,90,194,0.12)", "rgba(173,198,255,0.20)"),
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
  "--dsw-alias-button-tool-bar-fill": bg("rgba(92,94,102,0.4)", "rgba(227,226,230,0.4)"),
  "--dsw-alias-button-tool-bar-fill-invisible": bg("rgba(92,94,102,0.24)", "rgba(227,226,230,0.24)"),
  "--dsw-alias-button-tool-bar-hover": bg("rgba(92,94,102,0.5)", "rgba(227,226,230,0.5)"),

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
  "--dsw-specific-sidebar-fill": bg(NEUTRAL.n99, NEUTRAL.n4),
  "--dsw-specific-sidebar-nav-item-hover": bg(NEUTRAL.n95, NEUTRAL.n12),
  "--dsw-specific-sidebar-nav-item-active": bg(PRIMARY.p90, PRIMARY.p30),
  // primary-container tones: the "Recommended" badge background must contrast
  // with its text token --dsw-alias-button-info-fill (p40/p80)
  "--dsw-specific-sidebar-nav-item-active-accent": bg(PRIMARY.p90, PRIMARY.p30),
  "--dsw-specific-bubble": bg(PRIMARY.p95, PRIMARY.p30),
  "--dsw-specific-bubble-highlight": bg(PRIMARY.p80, PRIMARY.p40),
  "--dsw-specific-input-major": bg(NEUTRAL.n100, NEUTRAL.n22),
  "--dsw-specific-login-input": bg(NEUTRAL.n98, NEUTRAL.n12),
  "--dsw-specific-selector": bg(NEUTRAL.n96, NEUTRAL.n22),
  "--dsw-specific-menu": bg(NEUTRAL.n98, NEUTRAL.n24),
  "--dsw-specific-tip": bg(NEUTRAL.n96, NEUTRAL.n22),
};

export default materialYouTokens;
