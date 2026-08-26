/**
 * Material You skin - client plugin body.
 *
 * Registers the HCT tonal palette as a token override layer over the
 * built-in light/dark themes (ctx.theme.overrideTokens), so the system
 * preference keeps auto-switching while rendering Material You colors in
 * both schemes. Also injects Maple Mono typography + M3 shape tokens.
 */
import { materialYouTokens } from './tokens.mjs';
import fontStyles from './fonts.css?inline';

const SOURCE = 'dsh-skin-material-you';
const STYLE_TAG_ID = SOURCE + '/material-you-styles';

function injectStyles(css) {
  if (typeof document === 'undefined') return null;
  if (document.querySelector('style[data-plugin="' + STYLE_TAG_ID + '"]')) return null;
  const tag = document.createElement('style');
  tag.dataset.plugin = STYLE_TAG_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
  return () => { tag.remove(); };
}

/** Split one {light,dark} override map into a single-scheme token map. */
function tokensFor(tokens, scheme) {
  const out = {};
  for (const name of Object.keys(tokens)) out[name] = tokens[name][scheme];
  return out;
}

/**
 * Client fiber inject: SERVICE names (not package names). The ThemeRuntime
 * service is registered by @deepseek-ai/dsh-client-ui-theme under the name
 * `theme`; the manifest-side package list lives in package.json dsh.client.inject.
 */
export const inject = ['theme'];

export function apply(ctx) {
  const disposeOverride = ctx.theme.overrideTokens(SOURCE, materialYouTokens);
  const disposeStyles = injectStyles(fontStyles);

  const disposeLight = ctx.theme.register({
    id: 'material-you-light',
    colorScheme: 'light',
    tokens: tokensFor(materialYouTokens, 'light'),
  });
  const disposeDark = ctx.theme.register({
    id: 'material-you-dark',
    colorScheme: 'dark',
    tokens: tokensFor(materialYouTokens, 'dark'),
  });

  ctx.effect(() => {
    return () => {
      disposeOverride();
      disposeLight();
      disposeDark();
      if (disposeStyles) disposeStyles();
    };
  }, SOURCE + ': dispose');
}
