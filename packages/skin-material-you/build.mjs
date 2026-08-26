// Rebuild lib/ from src/: the client bundle (tokens.mjs + fonts.css +
// palette.css inlined into a __ModuleLoader__.load call) plus the host-half
// entry and its typings. lib/ is generated output and is not committed.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { materialYouTokens } from './src/tokens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fontsCss = readFileSync(join(here, 'src/fonts.css'), 'utf8');
const paletteCss = readFileSync(join(here, 'src/palette.css'), 'utf8');
const styleCss = fontsCss + '\n' + paletteCss;
mkdirSync(join(here, 'lib'), { recursive: true });

const tokensJson = JSON.stringify(materialYouTokens);
const cssJson = JSON.stringify(styleCss);

const bundle = `window.__ModuleLoader__.load({
	id: "dsh-skin-material-you",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		// ---- inlined Material You token override map (HCT tonal palettes) ----
		const materialYouTokens = ${tokensJson};

		// ---- inlined CSS (MapleMono typography + M3 shape/type tokens + palette ref) ----
		const SKIN_STYLE_TAG = 'material-you/skin-styles';
		const styleCss = ${cssJson};

		function injectSkinStyles() {
			if (typeof document === 'undefined') return null;
			if (document.querySelector('style[data-plugin="' + SKIN_STYLE_TAG + '"]')) return null;
			const tag = document.createElement('style');
			tag.dataset.plugin = SKIN_STYLE_TAG;
			tag.textContent = styleCss;
			document.head.appendChild(tag);
			return () => { tag.remove(); };
		}

		function tokensFor(tokens, scheme) {
			const out = {};
			for (const name of Object.keys(tokens)) out[name] = tokens[name][scheme];
			return out;
		}

		function apply(ctx) {
			const disposeOverride = ctx.theme.overrideTokens("dsh-skin-material-you", materialYouTokens);
			const disposeStyles = injectSkinStyles();
			const disposeLight = ctx.theme.register({ id: 'material-you-light', colorScheme: 'light', tokens: tokensFor(materialYouTokens, 'light') });
			const disposeDark = ctx.theme.register({ id: 'material-you-dark', colorScheme: 'dark', tokens: tokensFor(materialYouTokens, 'dark') });
			ctx.effect(() => {
				return () => { disposeOverride(); disposeLight(); disposeDark(); if (disposeStyles) disposeStyles(); };
			}, "dsh-skin-material-you: dispose");
		}

		exports.apply = apply;
		exports.name = "dsh-skin-material-you";
		exports.inject = ['theme'];
		return module.exports;
	}
});
`;

writeFileSync(join(here, 'lib/client.js'), bundle, 'utf8');
for (const f of ['index.js', 'index.d.ts', 'client.d.ts']) {
	copyFileSync(join(here, 'src', f), join(here, 'lib', f));
}
console.log('lib/ rebuilt: client.js', bundle.length, 'bytes + index.js, index.d.ts, client.d.ts');
