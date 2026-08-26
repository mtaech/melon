/**
 * Host half of the Material You skin.
 *
 * The skin is a pure client-side plugin: all behavior lives in ./client.js
 * (registered via dsh.client / exports["./client"]). The host half is a
 * no-op entry so the loader row resolves; it exists to keep the package a
 * valid cordis plugin on the host plane while the browser half does the work.
 */
const name = "@deepseek-ai/dsh-skin-material-you";

function apply() {
  /* no host-side behavior needed */
}

export default { name, apply };
