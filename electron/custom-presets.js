'use strict';

const CUSTOM_PRESET_FILE_VERSION = 1;
const MAX_CUSTOM_PRESETS = 100;
const MAX_CUSTOM_PRESET_FILE_BYTES = 512_000;
const MAX_CUSTOM_PRESET_PATCH_BYTES = 64_000;
const MAX_PRESET_TREE_DEPTH = 12;
const MAX_PRESET_TREE_NODES = 20_000;
const MAX_PRESET_ARRAY_ITEMS = 256;
const MAX_PRESET_OBJECT_KEYS = 128;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_PATCH_KEYS = new Set([
  'profile', 'profileAmount', 'bw', 'light', 'curve', 'color', 'mixer',
  'pointColor', 'calibration', 'grading', 'effects', 'detail', 'optics'
]);
const ENVELOPE_KEYS = new Set(['app', 'type', 'version', 'exportedAt', 'presets']);
const PRESET_KEYS = new Set(['id', 'name', 'group', 'includePhotoSettings', 'createdAt', 'updatedAt', 'patch']);

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8Bytes(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function normalizePresetLabel(value, maximum, fallback = '') {
  let normalized = String(value ?? '');
  try { normalized = normalized.normalize('NFKC'); } catch {}
  normalized = normalized.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...normalized].slice(0, maximum).join('') || fallback;
}

function inspectJsonTree(value, state = { nodes: 0, seen: new WeakSet() }, depth = 0, maximumNumber = Number.MAX_SAFE_INTEGER) {
  state.nodes++;
  if (state.nodes > MAX_PRESET_TREE_NODES) throw new RangeError('Preset data has too many values');
  if (depth > MAX_PRESET_TREE_DEPTH) throw new RangeError('Preset data is nested too deeply');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > maximumNumber) throw new TypeError('Preset numbers must be finite and bounded');
    return;
  }
  if (typeof value === 'string') {
    if (utf8Bytes(value) > 4_096) throw new RangeError('Preset text value is too large');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('Preset data contains an unsupported value');
  if (state.seen.has(value)) throw new TypeError('Preset data must not be cyclic or reuse object references');
  state.seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_PRESET_ARRAY_ITEMS) throw new RangeError('Preset array is too large');
    for (const item of value) inspectJsonTree(item, state, depth + 1, maximumNumber);
    return;
  }
  if (!isRecord(value)) throw new TypeError('Preset objects must be plain records');
  const keys = Object.keys(value);
  if (keys.length > MAX_PRESET_OBJECT_KEYS) throw new RangeError('Preset object has too many fields');
  for (const key of keys) {
    if (BLOCKED_KEYS.has(key)) throw new TypeError('Preset data contains a blocked key');
    if (utf8Bytes(key) > 128) throw new RangeError('Preset field name is too large');
    inspectJsonTree(value[key], state, depth + 1, maximumNumber);
  }
}

function requireExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} contains an unsupported field`);
}

function normalizePresetRecord(raw, usedIds) {
  if (!isRecord(raw)) throw new TypeError('Preset entry must be an object');
  requireExactKeys(raw, PRESET_KEYS, 'Preset entry');
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id) || usedIds.has(raw.id)) throw new TypeError('Preset ID is invalid or duplicated');
  usedIds.add(raw.id);
  const name = normalizePresetLabel(raw.name, 60);
  const group = normalizePresetLabel(raw.group, 40, 'User');
  if (!name) throw new TypeError('Preset name is required');
  if (typeof raw.includePhotoSettings !== 'boolean') throw new TypeError('Preset photo-setting scope is invalid');
  if (!Number.isSafeInteger(raw.createdAt) || raw.createdAt < 0 || !Number.isSafeInteger(raw.updatedAt) || raw.updatedAt < 0) throw new TypeError('Preset timestamps are invalid');
  if (!isRecord(raw.patch)) throw new TypeError('Preset patch must be an object');
  const patchKeys = Object.keys(raw.patch);
  if (!patchKeys.length || patchKeys.some(key => !ALLOWED_PATCH_KEYS.has(key))) throw new TypeError('Preset patch contains unsupported settings');
  inspectJsonTree(raw.patch, { nodes: 0, seen: new WeakSet() }, 0, 1_000_000_000);
  const patchText = JSON.stringify(raw.patch);
  if (utf8Bytes(patchText) > MAX_CUSTOM_PRESET_PATCH_BYTES) throw new RangeError('Preset patch is too large');
  return {
    id: raw.id,
    name,
    group,
    includePhotoSettings: raw.includePhotoSettings,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    patch: JSON.parse(patchText)
  };
}

function validateCustomPresetEnvelope(input) {
  let raw = input;
  if (typeof input === 'string') {
    if (!input.length || utf8Bytes(input) > MAX_CUSTOM_PRESET_FILE_BYTES) throw new RangeError('Custom preset file is empty or too large');
    raw = JSON.parse(input);
  }
  inspectJsonTree(raw);
  if (!isRecord(raw)) throw new TypeError('Custom preset file must contain an object');
  requireExactKeys(raw, ENVELOPE_KEYS, 'Custom preset file');
  if (raw.app !== 'Luma Darkroom' || raw.type !== 'custom-presets' || raw.version !== CUSTOM_PRESET_FILE_VERSION) throw new TypeError('Custom preset file type or version is unsupported');
  if (typeof raw.exportedAt !== 'string' || raw.exportedAt.length > 64 || !Number.isFinite(Date.parse(raw.exportedAt))) throw new TypeError('Custom preset export timestamp is invalid');
  if (!Array.isArray(raw.presets) || raw.presets.length > MAX_CUSTOM_PRESETS) throw new RangeError('Custom preset count is invalid');
  const usedIds = new Set();
  const normalized = {
    app: 'Luma Darkroom',
    type: 'custom-presets',
    version: CUSTOM_PRESET_FILE_VERSION,
    exportedAt: new Date(raw.exportedAt).toISOString(),
    presets: raw.presets.map(preset => normalizePresetRecord(preset, usedIds))
  };
  const text = JSON.stringify(normalized, null, 2);
  if (utf8Bytes(text) > MAX_CUSTOM_PRESET_FILE_BYTES) throw new RangeError('Custom preset file is too large');
  return normalized;
}

function serializeCustomPresetEnvelope(input) {
  return JSON.stringify(validateCustomPresetEnvelope(input), null, 2) + '\n';
}

module.exports = {
  CUSTOM_PRESET_FILE_VERSION,
  MAX_CUSTOM_PRESETS,
  MAX_CUSTOM_PRESET_FILE_BYTES,
  MAX_CUSTOM_PRESET_PATCH_BYTES,
  ALLOWED_PATCH_KEYS,
  normalizePresetLabel,
  validateCustomPresetEnvelope,
  serializeCustomPresetEnvelope
};
