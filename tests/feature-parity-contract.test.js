'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const file = path.join(root, 'docs', 'FEATURE_PARITY.md');
const text = fs.readFileSync(file, 'utf8');

test('capability matrix covers every public feature family', () => {
  for (const heading of ['## Editing and output', '## Masks and retouching', '## Workflow']) {
    assert.match(text, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const capability of [
    'Lens blur', 'HDR edit and output', 'Point Color', 'AI-powered denoise',
    'Tone curves', 'Color grading', 'Sharpening, noise reduction, grain',
    'Manual lens adjustments', 'Fringe color reduction', 'Geometric corrections',
    'Camera calibration', 'Crop and straighten', 'Content-aware or generative remove',
    'Reflection removal', 'Background-people removal', 'Red-eye correction',
    'Pet-eye correction', 'Layered masks', 'Linear and radial gradients',
    'Color and luminance range masks', 'Select subject', 'Select sky',
    'Select object', 'Select people', 'Select background',
    'Select landscape elements', 'Post-crop vignette', 'Presets and batch editing'
  ]) assert.ok(text.includes(`| ${capability} |`), `missing capability row: ${capability}`);
});

test('unsupported architecture is described without false availability claims', () => {
  for (const unavailable of [
    'AI-powered denoise', 'HDR edit and output', 'Content-aware or generative remove',
    'Reflection removal', 'Background-people removal', 'Select landscape elements',
    'Camera-RAW development'
  ]) {
    const row = text.split('\n').find(line => line.startsWith(`| ${unavailable} |`));
    assert.ok(row, `missing row: ${unavailable}`);
    assert.match(row, /\| Not available \|/);
  }
  assert.match(text, /8-bit, sRGB-oriented Canvas/);
  assert.match(text, /photographs are not uploaded for selection/);
});

test('capability document stays product-neutral', () => {
  const forbidden = [
    'QWRvYmU=', 'TGlnaHRyb29t', 'UGhvdG9zaG9w', 'RmlyZWZseQ==',
    'ZGFya3RhYmxl', 'UmF3VGhlcmFwZWU=', 'UmFwaWRSQVc='
  ].map(value => Buffer.from(value, 'base64').toString('utf8'));
  for (const name of forbidden) assert.equal(text.toLocaleLowerCase().includes(name.toLocaleLowerCase()), false, `brand reference found: ${name}`);
});
