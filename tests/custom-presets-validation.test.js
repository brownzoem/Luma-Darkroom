'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_CUSTOM_PRESETS,
  MAX_CUSTOM_PRESET_FILE_BYTES,
  normalizePresetLabel,
  validateCustomPresetEnvelope,
  serializeCustomPresetEnvelope
} = require('../electron/custom-presets');

const preset = (overrides = {}) => ({
  id: 'user-safe-1',
  name: 'Soft Color',
  group: 'User',
  includePhotoSettings: false,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
  patch: { light: { contrast: 14, highlights: -20 }, color: { vibrance: 12 } },
  ...overrides
});

const envelope = (presets = [preset()]) => ({
  app: 'Luma Darkroom',
  type: 'custom-presets',
  version: 1,
  exportedAt: '2026-08-20T12:00:00.000Z',
  presets
});

test('normalizes labels and produces a canonical bounded round trip', () => {
  assert.equal(normalizePresetLabel('  Studio\u0000   Warm  ', 60), 'Studio Warm');
  const normalized = validateCustomPresetEnvelope(envelope([preset({ name: '  Studio\u0000   Warm  ', group: '  Client   One ' })]));
  assert.equal(normalized.presets[0].name, 'Studio Warm');
  assert.equal(normalized.presets[0].group, 'Client One');
  const text = serializeCustomPresetEnvelope(normalized);
  assert.ok(text.endsWith('\n'));
  assert.ok(Buffer.byteLength(text, 'utf8') < MAX_CUSTOM_PRESET_FILE_BYTES);
  assert.deepEqual(validateCustomPresetEnvelope(text), normalized);
});

test('rejects unsupported edit domains and prototype-pollution keys', () => {
  assert.throws(() => validateCustomPresetEnvelope(envelope([preset({ patch: { geometry: { rotate: 10 } } })])), /unsupported settings/);
  const hostile = JSON.parse('{"app":"Luma Darkroom","type":"custom-presets","version":1,"exportedAt":"2026-08-20T12:00:00.000Z","presets":[{"id":"user-hostile","name":"Hostile","group":"User","includePhotoSettings":false,"createdAt":1,"updatedAt":1,"patch":{"light":{"contrast":5,"__proto__":{"polluted":true}}}}]}');
  assert.throws(() => validateCustomPresetEnvelope(hostile), /blocked key/);
  assert.equal({}.polluted, undefined);
});

test('rejects non-finite, cyclic, duplicated, and unexpected values', () => {
  assert.throws(() => validateCustomPresetEnvelope(envelope([preset({ patch: { light: { contrast: Infinity } } })])), /finite/);
  assert.throws(() => validateCustomPresetEnvelope(envelope([preset(), preset({ name: 'Duplicate' })])), /duplicated/);
  assert.throws(() => validateCustomPresetEnvelope({ ...envelope(), extra: true }), /unsupported field/);
  assert.throws(() => validateCustomPresetEnvelope(envelope([preset({ unexpected: true })])), /unsupported field/);
  const cyclic = envelope();
  cyclic.presets[0].patch.light.loop = cyclic;
  assert.throws(() => validateCustomPresetEnvelope(cyclic), /cyclic|reuse object references/);
});

test('enforces file, count, patch, and structural bounds', () => {
  const tooMany = Array.from({ length: MAX_CUSTOM_PRESETS + 1 }, (_, index) => preset({ id: `user-${index}`, name: `Preset ${index}` }));
  assert.throws(() => validateCustomPresetEnvelope(envelope(tooMany)), /count|too many/i);
  assert.throws(() => validateCustomPresetEnvelope(envelope([preset({ patch: { curve: { rgb: Array.from({ length: 257 }, () => [0, 0]) } } })])), /array is too large/);
  assert.throws(() => validateCustomPresetEnvelope(envelope([preset({ patch: { profile: 'x'.repeat(65_000) } })])), /text value|too large/);
  assert.throws(() => validateCustomPresetEnvelope(' '.repeat(MAX_CUSTOM_PRESET_FILE_BYTES + 1)), /too large/);
});
