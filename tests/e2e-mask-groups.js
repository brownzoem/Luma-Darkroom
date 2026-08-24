/**
 * Focused end-to-end coverage for the editable mask tree. This exercises the
 * persisted schema and the user-facing selection/group/combine workflow rather
 * than reaching through private helpers to perform the actions under test.
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `mask-groups-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });

const failures = [];
const check = (condition, message, detail) => {
  if (!condition) failures.push(message + (detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`));
};
const mark = label => process.stderr.write(`\nSTEP ${label}\n`);

let app;
let fixtures;

async function waitForPreview(page) {
  await page.waitForFunction(
    () => current && sourceImage.naturalWidth > 0 && !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && canvas.width > 100,
    null,
    { timeout: 30000 },
  );
}

async function seedGeometryMasks(page, count = 3) {
  await page.evaluate(maskCount => {
    const shape = (id, name, cx, exposure) => E.defaultMaskLayer({
      id,
      name,
      type: 'geometry',
      space: 'frame',
      feather: 0,
      opacity: 100,
      show: false,
      subjectExposure: exposure,
      regions: [{ kind: 'shape', mode: 'add', shape: 'rect', cx, cy: 0.5, w: 0.55, h: 0.8, rotation: 0, roundness: 0 }],
    });
    const available = [
      shape('mask-a', 'Left shape', 0.35, 0.8),
      shape('mask-b', 'Right shape', 0.65, 0.8),
      shape('mask-c', 'Center shape', 0.5, -0.35),
      shape('mask-d', 'Lower shape', 0.42, 0.25),
      shape('mask-e', 'Upper shape', 0.58, -0.2),
    ];
    current.edits = E.defaultEdits();
    current.edits.masks.layers = available.slice(0, maskCount);
    current.edits.masks.activeId = 'mask-a';
    maskSelectedIds = new Set(['mask-a']);
    maskSelectionAnchorId = 'mask-a';
    maskViewLayerId = '';
    const [undo, redo] = historyStacks();
    undo.length = 0;
    redo.length = 0;
    switchRightPanel('mask');
    refreshControls();
    scheduleRender();
    updateUndoButtons();
  }, count);
  await page.locator('#maskList .mask-row').first().waitFor({ state: 'visible' });
  await waitForPreview(page);
}

async function selectMask(page, id, modifiers = []) {
  await page.locator(`#maskList .mask-row[data-mask-id="${id}"] .mask-thumb`).click({ modifiers });
}

async function combineSelected(page, mode) {
  await page.click('#combineMasksBtn');
  await page.locator(`#combineMasksMenu [data-combine-mode="${mode}"]`).click();
  await page.waitForFunction(() => current.edits.masks.layers[0]?.type === 'group');
  await waitForPreview(page);
}

async function previewExportParity(page) {
  return page.evaluate(async () => {
    const previewContext = canvas.getContext('2d', { willReadFrequently: true });
    const preview = new Uint8ClampedArray(previewContext.getImageData(0, 0, canvas.width, canvas.height).data);
    const result = await renderExportInWorker(sourceImage, E.clone(current.edits), {
      maxEdge: previewEdge(false),
      watermark: '',
      mime: 'image/png',
      quality: 1,
    });
    const bitmap = await createImageBitmap(new Blob([result.bytes], { type: result.mime }));
    const decoded = document.createElement('canvas');
    decoded.width = bitmap.width;
    decoded.height = bitmap.height;
    decoded.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const exported = decoded.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, decoded.width, decoded.height).data;
    let maximumDelta = 0;
    let totalDelta = 0;
    for (let index = 0; index < Math.min(preview.length, exported.length); index += 1) {
      const delta = Math.abs(preview[index] - exported[index]);
      maximumDelta = Math.max(maximumDelta, delta);
      totalDelta += delta;
    }
    return {
      previewSize: [canvas.width, canvas.height],
      exportSize: [decoded.width, decoded.height],
      maximumDelta,
      meanDelta: totalDelta / Math.max(1, preview.length),
      workerReleased: activeExportWorker === null,
    };
  });
}

(async () => {
  fixtures = await createPhotoFixtures(1);
  const errors = [];
  app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-software-rasterizer',
      '--in-process-gpu',
      `--user-data-dir=${userData}`,
      root,
    ],
    cwd: runtimeCwd,
  });

  let page = await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1200));
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  page.on('pageerror', error => errors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`);
  });

  if (await page.locator('#tutorialDialog[open]').count()) {
    await page.click('#tutorialSkip');
    await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
  }

  await page.evaluate(filePath => {
    const photo = E.migratePhoto({ id: 'mask-group-photo', filePath, name: 'mask-group-photo.jpg', importedAt: 123456 });
    photos = [photo];
    updateLibrary();
    selectPhoto(photo);
  }, fixtures.paths[0]);
  await waitForPreview(page);

  mark('schema migration and sanitization');
  const schema = await page.evaluate(() => {
    const nested = depth => depth === 0
      ? { id: 'deep-leaf', type: 'brush', combineMode: 'subtract' }
      : { id: `deep-${depth}`, type: 'group', groupKind: 'composite', children: [nested(depth - 1)] };
    const raw = E.defaultEdits();
    raw.version = 8;
    raw.masks = {
      activeId: 'child-active',
      layers: [{
        id: '<bad root id>',
        name: 'x'.repeat(100),
        type: 'group',
        groupKind: 'not-a-kind',
        collapsed: 'yes',
        opacity: 900,
        children: [
          { id: 'duplicate', name: 'First', type: 'geometry', combineMode: 'subtract', componentDensity: 900, regions: [] },
          { id: 'duplicate', name: 'Second', type: 'geometry', combineMode: 'difference', componentDensity: -50, regions: [] },
          { id: 'child-active', name: 'Active', type: 'brush', combineMode: 'not-a-mode', opacity: -50, componentDensity: Infinity },
          nested(7),
        ],
      }],
    };
    const migrated = E.migratedEdits(raw);
    const nodes = [];
    let maximumGroupDepth = 0;
    const visit = (items, depth = 1) => {
      for (const node of items || []) {
        nodes.push({ id: node.id, name: node.name, type: node.type, mode: node.combineMode, opacity: node.opacity, groupKind: node.groupKind });
        if (node.type === 'group') {
          maximumGroupDepth = Math.max(maximumGroupDepth, depth);
          visit(node.children, depth + 1);
        }
      }
    };
    visit(migrated.masks.layers);
    const rootGroup = migrated.masks.layers[0];
    const invalidActive = E.migratedEdits({ ...raw, masks: { ...raw.masks, activeId: 'missing-id' } });
    return {
      version: migrated.version,
      activeId: migrated.masks.activeId,
      fallbackActiveId: invalidActive.masks.activeId,
      rootId: rootGroup.id,
      rootNameLength: rootGroup.name.length,
      rootKind: rootGroup.groupKind,
      rootCollapsed: rootGroup.collapsed,
      rootOpacity: rootGroup.opacity,
      childModes: rootGroup.children.slice(0, 3).map(child => child.combineMode),
      childOpacities: rootGroup.children.slice(0, 3).map(child => child.opacity),
      childDensities: rootGroup.children.slice(0, 3).map(child => child.componentDensity),
      ids: nodes.map(node => node.id),
      safeIds: nodes.every(node => /^[A-Za-z0-9_-]+$/.test(node.id)),
      leaves: nodes.filter(node => node.type !== 'group').length,
      groups: nodes.filter(node => node.type === 'group').length,
      maximumGroupDepth,
    };
  });
  check(schema.version === 9, 'mask-tree migration advances to schema version 9', schema);
  check(schema.activeId === 'child-active' && schema.fallbackActiveId === schema.rootId, 'nested active IDs survive migration and invalid active IDs fall back safely', schema);
  check(schema.rootId === 'badrootid' && schema.rootNameLength === 60, 'group IDs and names are sanitized', schema);
  check(schema.rootKind === 'composite' && schema.rootCollapsed === false && schema.rootOpacity === 100, 'invalid group properties use safe bounded defaults', schema);
  check(schema.childModes.join(',') === 'add,difference,add' && schema.childOpacities[2] === 0 && schema.childDensities.join(',') === '100,0,100', 'combine modes, adjustment opacity, and component density are sanitized independently', schema);
  check(schema.safeIds && new Set(schema.ids).size === schema.ids.length, 'every migrated node receives a safe unique ID', schema);
  check(schema.leaves <= 8 && schema.groups <= 8 && schema.maximumGroupDepth <= 4, 'mask tree migration enforces leaf, group, and depth budgets', schema);

  mark('Ctrl and Shift multi-selection');
  await seedGeometryMasks(page, 3);
  const listA11y = await page.locator('#maskList').evaluate(element => ({
    role: element.getAttribute('role'),
    multiselectable: element.getAttribute('aria-multiselectable'),
  }));
  check(listA11y.role === 'tree' && listA11y.multiselectable === 'true', 'mask stack exposes a multi-select tree', listA11y);

  await selectMask(page, 'mask-a');
  await selectMask(page, 'mask-c', ['Control']);
  let selection = await page.evaluate(() => ({ ids: [...maskSelectedIds].sort(), active: current.edits.masks.activeId, count: document.querySelector('#maskSelectionCount')?.textContent }));
  check(selection.ids.join(',') === 'mask-a,mask-c' && selection.active === 'mask-c' && selection.count === '2 selected', 'Ctrl-click toggles noncontiguous mask selection', selection);

  await selectMask(page, 'mask-a');
  await selectMask(page, 'mask-c', ['Shift']);
  selection = await page.evaluate(() => ({ ids: [...maskSelectedIds].sort(), selectedRows: document.querySelectorAll('#maskList .mask-row[aria-selected="true"]').length, count: document.querySelector('#maskSelectionCount')?.textContent }));
  check(selection.ids.join(',') === 'mask-a,mask-b,mask-c' && selection.selectedRows === 3 && selection.count === '3 selected', 'Shift-click selects a contiguous mask range', selection);
  if (process.env.LUMA_MASK_MULTI_SCREENSHOT) await page.screenshot({ path: path.resolve(process.env.LUMA_MASK_MULTI_SCREENSHOT), fullPage: true });

  mark('multi-selected sibling block reorder');
  await seedGeometryMasks(page, 5);
  await selectMask(page, 'mask-b');
  await selectMask(page, 'mask-d', ['Shift']);
  const contiguousBefore = await page.evaluate(() => ({
    order: current.edits.masks.layers.map(node => node.id),
    selected: [...maskSelectedIds].sort(),
    active: current.edits.masks.activeId,
  }));
  await page.locator('#maskList .mask-row[data-mask-id="mask-d"]').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForFunction(() => current.edits.masks.layers[0]?.id === 'mask-b');
  const contiguousMoved = await page.evaluate(() => ({
    order: current.edits.masks.layers.map(node => node.id),
    selected: [...maskSelectedIds].sort(),
    active: current.edits.masks.activeId,
    undoDepth: historyStacks()[0].length,
    undoLabel: historyStacks()[0].at(-1)?.label,
  }));
  check(contiguousBefore.order.join(',') === 'mask-a,mask-b,mask-c,mask-d,mask-e' && contiguousBefore.selected.join(',') === 'mask-b,mask-c,mask-d', 'contiguous reorder starts from the expected selected sibling block', contiguousBefore);
  check(contiguousMoved.order.join(',') === 'mask-b,mask-c,mask-d,mask-a,mask-e', 'Alt+ArrowUp moves the contiguous selection as one stable block', contiguousMoved);
  check(contiguousMoved.selected.join(',') === contiguousBefore.selected.join(',') && contiguousMoved.active === contiguousBefore.active, 'keyboard block reorder preserves selection and active mask', contiguousMoved);
  check(contiguousMoved.undoDepth === 1 && contiguousMoved.undoLabel === 'Reorder selected masks', 'contiguous block reorder creates one history entry', contiguousMoved);
  await page.click('#undoBtn');
  await page.waitForFunction(() => current.edits.masks.layers[0]?.id === 'mask-a');
  const contiguousUndone = await page.evaluate(() => ({
    order: current.edits.masks.layers.map(node => node.id),
    selected: [...maskSelectedIds].sort(),
    redoDepth: historyStacks()[1].length,
    redoLabel: historyStacks()[1].at(-1)?.label,
  }));
  check(contiguousUndone.order.join(',') === contiguousBefore.order.join(',') && contiguousUndone.selected.join(',') === contiguousBefore.selected.join(',') && contiguousUndone.redoDepth === 1 && contiguousUndone.redoLabel === 'Reorder selected masks', 'one Undo restores the contiguous move and keeps its selection', contiguousUndone);

  await seedGeometryMasks(page, 5);
  await selectMask(page, 'mask-b');
  await selectMask(page, 'mask-d', ['Control']);
  const noncontiguousBefore = await page.evaluate(() => ({
    order: current.edits.masks.layers.map(node => node.id),
    selected: [...maskSelectedIds].sort(),
    active: current.edits.masks.activeId,
  }));
  await page.locator('#maskList .mask-row[data-mask-id="mask-d"] .mask-row-more').click();
  await page.click('#maskMoveDown');
  await page.waitForFunction(() => current.edits.masks.layers.at(-1)?.id === 'mask-d');
  const noncontiguousMoved = await page.evaluate(() => ({
    order: current.edits.masks.layers.map(node => node.id),
    selected: [...maskSelectedIds].sort(),
    active: current.edits.masks.activeId,
    undoDepth: historyStacks()[0].length,
    undoLabel: historyStacks()[0].at(-1)?.label,
  }));
  check(noncontiguousBefore.order.join(',') === 'mask-a,mask-b,mask-c,mask-d,mask-e' && noncontiguousBefore.selected.join(',') === 'mask-b,mask-d', 'noncontiguous reorder starts from the expected selected siblings', noncontiguousBefore);
  check(noncontiguousMoved.order.join(',') === 'mask-a,mask-c,mask-b,mask-e,mask-d', 'Move down shifts every noncontiguous selected sibling one slot while preserving relative order', noncontiguousMoved);
  check(noncontiguousMoved.selected.join(',') === noncontiguousBefore.selected.join(',') && noncontiguousMoved.active === noncontiguousBefore.active, 'menu-driven noncontiguous reorder preserves selection and active mask', noncontiguousMoved);
  check(noncontiguousMoved.undoDepth === 1 && noncontiguousMoved.undoLabel === 'Reorder selected masks', 'noncontiguous reorder creates one history entry', noncontiguousMoved);
  await page.click('#undoBtn');
  await page.waitForFunction(() => current.edits.masks.layers.at(-1)?.id === 'mask-e');
  const noncontiguousUndone = await page.evaluate(() => ({
    order: current.edits.masks.layers.map(node => node.id),
    selected: [...maskSelectedIds].sort(),
    redoDepth: historyStacks()[1].length,
    redoLabel: historyStacks()[1].at(-1)?.label,
  }));
  check(noncontiguousUndone.order.join(',') === noncontiguousBefore.order.join(',') && noncontiguousUndone.selected.join(',') === noncontiguousBefore.selected.join(',') && noncontiguousUndone.redoDepth === 1 && noncontiguousUndone.redoLabel === 'Reorder selected masks', 'one Undo restores the noncontiguous move and keeps its selection', noncontiguousUndone);

  await seedGeometryMasks(page, 5);
  await selectMask(page, 'mask-b');
  await selectMask(page, 'mask-d', ['Control']);
  const dragSource = await page.locator('#maskList .mask-row[data-mask-id="mask-b"]').boundingBox();
  const dragTarget = await page.locator('#maskList .mask-row[data-mask-id="mask-e"]').boundingBox();
  check(!!dragSource && !!dragTarget, 'multi-row drag targets are visible', { dragSource, dragTarget });
  if (dragSource && dragTarget) {
    await page.mouse.move(dragSource.x + dragSource.width * 0.55, dragSource.y + dragSource.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(dragSource.x + dragSource.width * 0.55, dragTarget.y + dragTarget.height - 1, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => current.edits.masks.layers.map(node => node.id).join(',') === 'mask-a,mask-c,mask-e,mask-b,mask-d');
  }
  const dragged = await page.evaluate(() => ({
    order: current.edits.masks.layers.map(node => node.id),
    selected: [...maskSelectedIds].sort(),
    active: current.edits.masks.activeId,
    undoDepth: historyStacks()[0].length,
    undoLabel: historyStacks()[0].at(-1)?.label,
  }));
  check(dragged.order.join(',') === 'mask-a,mask-c,mask-e,mask-b,mask-d', 'dragging one selected row moves the full selection as a stable block', dragged);
  check(dragged.selected.join(',') === 'mask-b,mask-d' && dragged.active === 'mask-b' && dragged.undoDepth === 1 && dragged.undoLabel === 'Reorder selected masks', 'multi-row drag preserves selection and records one undoable edit', dragged);
  await page.click('#undoBtn');
  await page.waitForFunction(() => current.edits.masks.layers.map(node => node.id).join(',') === 'mask-a,mask-b,mask-c,mask-d,mask-e');
  const dragUndone = await page.evaluate(() => ({ order: current.edits.masks.layers.map(node => node.id), selected: [...maskSelectedIds].sort(), active: current.edits.masks.activeId }));
  check(dragUndone.selected.join(',') === 'mask-b,mask-d' && dragUndone.active === 'mask-d', 'Undo restores the drag order, selection, and prior primary mask', dragUndone);

  mark('Add, Subtract, Intersect, and Difference');
  const modeSamples = {};
  for (const mode of ['add', 'subtract', 'intersect', 'difference']) {
    await seedGeometryMasks(page, 2);
    await selectMask(page, 'mask-a');
    await selectMask(page, 'mask-b', ['Control']);
    await combineSelected(page, mode);
    const result = await page.evaluate(() => {
      const group = current.edits.masks.layers[0];
      const rendered = E.render(sourceImage, current.edits, { maxEdge: 240, maskOnly: group.id });
      const context = rendered.getContext('2d', { willReadFrequently: true });
      const valueAt = (x, y = 0.5) => context.getImageData(
        Math.max(0, Math.min(rendered.width - 1, Math.round(x * (rendered.width - 1)))),
        Math.max(0, Math.min(rendered.height - 1, Math.round(y * (rendered.height - 1)))),
        1,
        1,
      ).data[0];
      return {
        group: { type: group.type, kind: group.groupKind, children: group.children.map(child => ({ id: child.id, mode: child.combineMode })) },
        samples: { left: valueAt(0.18), overlap: valueAt(0.5), right: valueAt(0.82), outside: valueAt(0.98, 0.05) },
      };
    });
    modeSamples[mode] = result.samples;
    check(result.group.type === 'group' && result.group.kind === 'composite' && result.group.children.length === 2, `${mode} creates one editable composite group`, result);
    check(result.group.children[0].mode === 'add' && result.group.children[1].mode === mode, `${mode} stores the expected ordered component modes`, result);
  }
  check(modeSamples.add.left > 220 && modeSamples.add.overlap > 220 && modeSamples.add.right > 220 && modeSamples.add.outside < 20, 'Add produces a union mask', modeSamples.add);
  check(modeSamples.subtract.left > 220 && modeSamples.subtract.overlap < 20 && modeSamples.subtract.right < 20 && modeSamples.subtract.outside < 20, 'Subtract removes later components from the base', modeSamples.subtract);
  check(modeSamples.intersect.left < 20 && modeSamples.intersect.overlap > 220 && modeSamples.intersect.right < 20 && modeSamples.intersect.outside < 20, 'Intersect keeps only overlap', modeSamples.intersect);
  check(modeSamples.difference.left > 220 && modeSamples.difference.overlap < 20 && modeSamples.difference.right > 220 && modeSamples.difference.outside < 20, 'Difference keeps non-overlapping coverage', modeSamples.difference);

  await seedGeometryMasks(page, 2);
  await page.evaluate(() => { maskById('mask-b').opacity = 42; refreshControls(); });
  await selectMask(page, 'mask-a');
  await selectMask(page, 'mask-b', ['Control']);
  await combineSelected(page, 'add');
  const densityGroupId = await page.evaluate(() => current.edits.masks.layers[0].id);
  await selectMask(page, 'mask-a');
  await page.locator('#control-mask-opacity').evaluate(element => { element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); element.value = '50'; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitForPreview(page);
  const childDensityUi = await page.evaluate(groupId => { const range = document.querySelector('#control-mask-opacity'), mask = E.render(sourceImage, current.edits, { maxEdge: 240, maskOnly: groupId }), context = mask.getContext('2d', { willReadFrequently: true }); return { path: range?.dataset.path, value: +range?.value, stored: maskById('mask-a').componentDensity, leftMask: context.getImageData(Math.round(mask.width * 0.18), Math.round(mask.height * 0.5), 1, 1).data[0] }; }, densityGroupId);
  await selectMask(page, densityGroupId);
  const densityModel = await page.evaluate(() => { const group = current.edits.masks.layers[0], primary = group.children.find(child => child.id === 'mask-b'); return { groupOpacity: group.opacity, childOpacity: primary.opacity, childDensity: primary.componentDensity, parentPath: document.querySelector('#control-mask-opacity')?.dataset.path, parentValue: +document.querySelector('#control-mask-opacity')?.value }; });
  check(densityModel.groupOpacity === 42 && densityModel.childOpacity === 42 && densityModel.childDensity === 100 && childDensityUi.path === 'mask.componentDensity' && childDensityUi.value === 50 && childDensityUi.stored === 50 && childDensityUi.leftMask >= 120 && childDensityUi.leftMask <= 135 && densityModel.parentPath === 'mask.opacity' && densityModel.parentValue === 42, 'combined-mask adjustment opacity and component density remain independent and precisely editable', { densityModel, childDensityUi });

  mark('nested group tree, collapse, and deep duplicate');
  await seedGeometryMasks(page, 3);
  await selectMask(page, 'mask-a');
  await selectMask(page, 'mask-b', ['Control']);
  await combineSelected(page, 'add');
  const compositeId = await page.evaluate(() => current.edits.masks.layers[0].id);
  await selectMask(page, compositeId);
  await selectMask(page, 'mask-c', ['Control']);
  await page.click('#groupMasksBtn');
  await page.waitForFunction(() => current.edits.masks.layers.length === 1 && current.edits.masks.layers[0]?.groupKind === 'folder');
  const folderId = await page.evaluate(() => current.edits.masks.layers[0].id);

  let tree = await page.evaluate(() => ({
    rowCount: document.querySelectorAll('#maskList .mask-row').length,
    rootExpanded: document.querySelector('#maskList .mask-row')?.getAttribute('aria-expanded'),
    levels: [...document.querySelectorAll('#maskList .mask-row')].map(row => Number(row.getAttribute('aria-level'))),
    rootRole: document.querySelector('#maskList .mask-row')?.getAttribute('role'),
    folderChildren: current.edits.masks.layers[0].children.length,
  }));
  check(tree.rowCount === 5 && tree.rootExpanded === 'true' && tree.rootRole === 'treeitem' && tree.levels.join(',') === '1,2,3,3,2' && tree.folderChildren === 2, 'grouping creates an expanded nested ARIA tree', tree);

  await page.locator(`#maskList .mask-row[data-mask-id="${folderId}"] .mask-disclosure`).click();
  await page.waitForFunction(() => document.querySelectorAll('#maskList .mask-row').length === 1);
  tree = await page.evaluate(() => ({
    rowCount: document.querySelectorAll('#maskList .mask-row').length,
    expanded: document.querySelector('#maskList .mask-row')?.getAttribute('aria-expanded'),
    active: current.edits.masks.activeId,
  }));
  check(tree.rowCount === 1 && tree.expanded === 'false' && tree.active === folderId, 'collapsing a group hides descendants and keeps a visible active row', tree);
  await page.locator(`#maskList .mask-row[data-mask-id="${folderId}"] .mask-disclosure`).click();
  await page.waitForFunction(() => document.querySelectorAll('#maskList .mask-row').length === 5);
  if (process.env.LUMA_MASK_GROUP_SCREENSHOT) await page.screenshot({ path: path.resolve(process.env.LUMA_MASK_GROUP_SCREENSHOT), fullPage: true });

  await page.locator(`#maskList .mask-row[data-mask-id="${folderId}"] .mask-row-more`).click();
  await page.click('#maskDuplicate');
  await page.waitForFunction(() => current.edits.masks.layers.length === 2);
  const duplicated = await page.evaluate(() => {
    const [copy, original] = current.edits.masks.layers;
    const flattenIds = node => [node.id, ...(node.type === 'group' ? node.children.flatMap(flattenIds) : [])];
    const shape = node => ({ type: node.type, kind: node.groupKind || '', children: node.type === 'group' ? node.children.map(shape) : [] });
    const copyIds = flattenIds(copy);
    const originalIds = flattenIds(original);
    return {
      copyId: copy.id,
      originalId: original.id,
      copyName: copy.name,
      copyIds,
      originalIds,
      uniqueIds: new Set([...copyIds, ...originalIds]).size,
      copiedShape: JSON.stringify(shape(copy)) === JSON.stringify(shape(original)),
      active: current.edits.masks.activeId,
    };
  });
  check(duplicated.copyId !== duplicated.originalId && duplicated.copyName.endsWith(' copy') && duplicated.active === duplicated.copyId, 'duplicate creates and selects a sibling group copy', duplicated);
  check(duplicated.copyIds.every(id => !duplicated.originalIds.includes(id)) && duplicated.uniqueIds === duplicated.copyIds.length + duplicated.originalIds.length && duplicated.copiedShape, 'deep duplicate refreshes every descendant ID while preserving tree structure', duplicated);

  mark('ungroup, multi-delete, and undo');
  await page.locator(`#maskList .mask-row[data-mask-id="${duplicated.copyId}"] .mask-row-more`).click();
  await page.click('#maskUngroup');
  await page.waitForFunction(() => current.edits.masks.layers.length === 3);
  const ungrouped = await page.evaluate(() => ({
    roots: current.edits.masks.layers.map(node => ({ id: node.id, type: node.type, kind: node.groupKind, leaves: node.type === 'group' ? node.children.length : 0 })),
    selected: [...maskSelectedIds],
    selectedCount: document.querySelector('#maskSelectionCount')?.textContent,
  }));
  check(ungrouped.roots[0].kind === 'composite' && ungrouped.roots[1].type === 'geometry' && ungrouped.roots[2].kind === 'folder', 'Ungroup restores the copied folder children at the same stack level', ungrouped);
  check(ungrouped.selected.length === 2 && ungrouped.selectedCount === '2 selected', 'Ungroup selects the restored children for the next bulk action', ungrouped);

  const beforeDelete = await page.evaluate(() => JSON.stringify(current.edits.masks.layers));
  await page.click('#deleteMasksBtn');
  await page.waitForFunction(() => current.edits.masks.layers.length === 1);
  const afterDelete = await page.evaluate(() => ({ roots: current.edits.masks.layers.length, leaves: maskLeafCount(), undoLabel: historyStacks()[0].at(-1)?.label }));
  check(afterDelete.roots === 1 && afterDelete.leaves === 3 && afterDelete.undoLabel === 'Delete selected masks', 'bulk Delete removes the selected ungrouped subtrees as one undoable edit', afterDelete);
  await page.click('#undoBtn');
  await page.waitForFunction(() => current.edits.masks.layers.length === 3);
  const afterUndo = await page.evaluate(expected => ({ exact: JSON.stringify(current.edits.masks.layers) === expected, leaves: maskLeafCount(), redoLabel: historyStacks()[1].at(-1)?.label }), beforeDelete);
  check(afterUndo.exact && afterUndo.leaves === 6 && afterUndo.redoLabel === 'Delete selected masks', 'Undo restores the complete deleted mask subtrees and IDs', afterUndo);

  mark('mask-only localization and preview/export parity');
  await seedGeometryMasks(page, 2);
  await selectMask(page, 'mask-a');
  await selectMask(page, 'mask-b', ['Control']);
  await combineSelected(page, 'intersect');
  const renderBehavior = await page.evaluate(() => {
    const group = current.edits.masks.layers[0];
    const mask = E.render(sourceImage, current.edits, { maxEdge: 240, maskOnly: group.id });
    const edited = E.render(sourceImage, current.edits, { maxEdge: 240 });
    const neutralEdits = E.clone(current.edits);
    neutralEdits.masks.layers[0].subjectExposure = 0;
    const neutral = E.render(sourceImage, neutralEdits, { maxEdge: 240 });
    const maskContext = mask.getContext('2d', { willReadFrequently: true });
    const editedData = edited.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, edited.width, edited.height).data;
    const neutralData = neutral.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, neutral.width, neutral.height).data;
    const sampleMask = (x, y) => maskContext.getImageData(Math.round(x * (mask.width - 1)), Math.round(y * (mask.height - 1)), 1, 1).data[0];
    const pixelDelta = (x, y) => {
      const px = Math.round(x * (edited.width - 1));
      const py = Math.round(y * (edited.height - 1));
      const offset = (py * edited.width + px) * 4;
      return Math.abs(editedData[offset] - neutralData[offset]) + Math.abs(editedData[offset + 1] - neutralData[offset + 1]) + Math.abs(editedData[offset + 2] - neutralData[offset + 2]);
    };
    return {
      insideMask: sampleMask(0.5, 0.5),
      outsideMask: sampleMask(0.98, 0.05),
      insideDelta: pixelDelta(0.5, 0.5),
      outsideDelta: pixelDelta(0.98, 0.05),
    };
  });
  check(renderBehavior.insideMask > 220 && renderBehavior.outsideMask < 20, 'maskOnly renders the final combined group coverage', renderBehavior);
  check(renderBehavior.insideDelta > 10 && renderBehavior.outsideDelta <= 1, 'combined local adjustments affect only the composed mask area', renderBehavior);

  await waitForPreview(page);
  const parity = await previewExportParity(page);
  check(parity.previewSize.join(',') === parity.exportSize.join(',') && parity.maximumDelta <= 1 && parity.meanDelta <= 0.02 && parity.workerReleased, 'combined-mask preview matches lossless background export', parity);

  const report = {
    schema,
    reorder: {
      contiguous: { before: contiguousBefore, moved: contiguousMoved, undone: contiguousUndone },
      noncontiguous: { before: noncontiguousBefore, moved: noncontiguousMoved, undone: noncontiguousUndone },
    },
    modeSamples,
    densityModel,
    duplicated,
    ungrouped,
    renderBehavior,
    parity,
    errors,
    failures,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await app.close();
  await fixtures.cleanup();
  fs.rmSync(userData, { recursive: true, force: true });
  if (failures.length || errors.length) throw new Error([...failures, ...errors].join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await app?.close(); } catch {}
  try { await fixtures?.cleanup(); } catch {}
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  process.exitCode = 1;
});
