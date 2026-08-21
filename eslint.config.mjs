/**
 * ESLint flat config.
 *
 * Two tiers:
 *  - New tool modules (src/tools.js, src/crop-tool.js) lint strictly,
 *    including no-undef against an explicit list of the app globals they
 *    are allowed to touch (the renderer shares one global scope across
 *    classic scripts, so this list documents the integration surface).
 *  - Legacy renderer/engine/electron/test files predate the linter and use
 *    an intentionally dense style; they get correctness-level rules only
 *    (syntax hazards, duplicate keys, unsafe negation) without stylistic
 *    or cross-script no-undef noise.
 */
import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly', document: 'readonly', console: 'readonly', navigator: 'readonly',
  localStorage: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', getComputedStyle: 'readonly',
  Image: 'readonly', Path2D: 'readonly', DOMMatrix: 'readonly', DOMPoint: 'readonly',
  ResizeObserver: 'readonly', Worker: 'readonly', OffscreenCanvas: 'readonly',
  createImageBitmap: 'readonly', Blob: 'readonly', atob: 'readonly', btoa: 'readonly',
  FileReader: 'readonly', URL: 'readonly', fetch: 'readonly', crypto: 'readonly'
};

/** app.js top-level bindings the tool modules integrate with. */
const appIntegrationGlobals = {
  $: 'readonly', $$: 'readonly', E: 'readonly', AI: 'readonly',
  current: 'readonly', sourceImage: 'readonly', view: 'readonly',
  toolMode: 'readonly', spacePanActive: 'readonly',
  MAX_MASK_LAYERS: 'readonly', BRUSH_TOOLS: 'readonly', RETOUCH_TOOLS: 'readonly',
  GRADIENT_TOOLS: 'readonly', POINT_TOOLS: 'readonly',
  activeMask: 'readonly', activateMaskBrush: 'readonly', addMaskAndActivate: 'readonly',
  beginSmartObjectSelection: 'readonly', commit: 'readonly', pushHistory: 'readonly',
  refreshControls: 'readonly', scheduleRender: 'readonly', debounceSave: 'readonly',
  switchRightPanel: 'readonly', toast: 'readonly', uid: 'readonly',
  uniqueMaskName: 'readonly', clearPresetTracking: 'readonly', applyZoom: 'readonly',
  openHelpCenter: 'readonly', remapEditPoints: 'readonly',
  // Bindings the tool layer intentionally reassigns (monkey-patch pattern).
  setTool: 'writable', catalogDirty: 'writable'
};

export default [
  { ignores: ['node_modules/**', 'outputs/**', 'work/**', 'third_party/**', 'assets/**'] },

  // Strict tier: the tool modules.
  {
    files: ['src/tools.js', 'src/crop-tool.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...browserGlobals, ...appIntegrationGlobals, globalThis: 'readonly', LumaToolRail: 'readonly', LumaCropTool: 'readonly' }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'error',
      'no-implicit-globals': 'error'
    }
  },

  // Correctness tier: everything else that executes.
  {
    files: ['src/**/*.js', 'electron/**/*.js', 'tests/**/*.js', 'scripts/**/*.js'],
    ignores: ['src/tools.js', 'src/crop-tool.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...browserGlobals, require: 'readonly', module: 'writable', process: 'readonly', __dirname: 'readonly', Buffer: 'readonly', globalThis: 'readonly', self: 'readonly', importScripts: 'readonly' }
    },
    rules: {
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unsafe-negation': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'valid-typeof': 'error',
      'use-isnan': 'error',
      'no-func-assign': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off'
    }
  }
];
