/**
 * Luma Darkroom — Interactive crop tool.
 *
 * Pro-editor crop mode: while active, the photo renders UNCROPPED so the
 * crop rectangle can be dragged over the full frame.
 *
 *   - 8 crop handles resize the rectangle (aspect presets lock the ratio,
 *     X swaps orientation, Shift temporarily locks the current ratio).
 *   - Dragging INSIDE the rectangle pans the photo underneath the crop
 *     (Lightroom behavior); holding Ctrl moves the rectangle itself.
 *   - Dragging OUTSIDE the rectangle rotates (straighten).
 *   - The photo's own frame shows round handles: corners zoom the photo
 *     in/out, edge midpoints stretch (distort) it horizontally/vertically.
 *   - A shape can be applied to the crop (oval, star, heart, …, or the
 *     outline of the active selection); the result exports with
 *     transparency on PNG/WebP/TIFF and flattens to white on JPEG.
 *   - O cycles guide overlays, Enter/double-click applies, Esc cancels.
 *
 * State is committed as `geometry.cropL/T/R/B` (fractions of the full
 * transformed frame) plus the `cropShape*` fields — see engine.js.
 * Loads after tools.js and registers itself with LumaToolRail.
 */
(() => {
  'use strict';

  const RATIOS = [
    ['Free', null], ['Original', 'original'], ['1 : 1', 1],
    ['3 : 2', 3 / 2], ['2 : 3', 2 / 3], ['4 : 3', 4 / 3], ['3 : 4', 3 / 4],
    ['4 : 5', 4 / 5], ['5 : 4', 5 / 4], ['5 : 7', 5 / 7], ['7 : 5', 7 / 5],
    ['16 : 9', 16 / 9], ['9 : 16', 9 / 16]
  ];
  const GUIDE_MODES = ['thirds', 'golden', 'grid', 'off'];
  const SHAPES = ['', 'oval', 'rounded', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'heart', 'arrow', 'selection'];
  const MIN_RECT_FRACTION = 0.03;
  const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const crop = {
    active: false,
    photoId: null,
    snapshot: null,
    rect: { l: 0, t: 0, r: 1, b: 1 },
    ratio: null,              // locked width/height in pixels, or null for free
    ratioLabel: 'Free',
    shapeKind: '',
    shapeRotation: 0,
    shapeFeather: 0,
    shapeRoundness: 40,
    shapePoints: [],
    guides: 'thirds',
    gesture: null,
    handleCache: ''
  };

  const rail = globalThis.LumaToolRail;
  const $handles = () => $('#cropHandles');

  function prepared() { return { geometry: current.edits.geometry, optics: current.edits.optics }; }
  function clamp01(value) { return Math.max(0, Math.min(1, value)); }
  function frameDims() { return rail.orientedDims(prepared()); }

  // ---------------------------------------------------------------------------
  // Enter / apply / cancel
  // ---------------------------------------------------------------------------

  function enter() {
    if (crop.active || !current) return;
    crop.active = true;
    crop.photoId = current.id;
    crop.snapshot = E.clone(current.edits);
    const geometry = current.edits.geometry;

    // Current crop rectangle over the full frame (rect crop wins, else legacy zoom crop).
    const rectSet = geometry.cropR - geometry.cropL < 1 - 1e-4 || geometry.cropB - geometry.cropT < 1 - 1e-4 || geometry.cropL > 1e-4 || geometry.cropT > 1e-4;
    if (rectSet) {
      crop.rect = { l: geometry.cropL, t: geometry.cropT, r: geometry.cropR, b: geometry.cropB };
    } else {
      const dims = frameDims();
      const metrics = E.geometryMetrics(dims.width, dims.height, prepared());
      crop.rect = {
        l: metrics.cx / dims.width, t: metrics.cy / dims.height,
        r: (metrics.cx + metrics.cw) / dims.width, b: (metrics.cy + metrics.ch) / dims.height
      };
    }
    crop.shapeKind = geometry.cropShapeKind === 'path' ? 'selection' : geometry.cropShapeKind;
    crop.shapeRotation = geometry.cropShapeRotation;
    crop.shapeFeather = geometry.cropShapeFeather;
    crop.shapeRoundness = geometry.cropShapeRoundness;
    crop.shapePoints = E.clone(geometry.cropShapePoints || []);
    crop.ratio = null;
    crop.ratioLabel = 'Free';

    // Show the full frame while cropping.
    geometry.cropL = 0; geometry.cropT = 0; geometry.cropR = 1; geometry.cropB = 1;
    geometry.cropZoom = 100; geometry.cropX = 0; geometry.cropY = 0;
    geometry.cropShapeKind = '';
    $handles()?.classList.remove('hidden');
    rail.cancelPendingDraft();
    scheduleRender();
    renderCropOptions();
  }

  function finishState() {
    crop.active = false;
    crop.gesture = null;
    crop.handleCache = '';
    $handles()?.classList.add('hidden');
  }

  function apply() {
    rail.cancelPendingDraft();
    if (!crop.active || !current || current.id !== crop.photoId) { finishState(); return; }
    finishState();
    const geometry = current.edits.geometry;
    const rect = normalizedRect();
    geometry.cropL = rect.l; geometry.cropT = rect.t; geometry.cropR = rect.r; geometry.cropB = rect.b;
    geometry.cropZoom = 100; geometry.cropX = 0; geometry.cropY = 0;
    geometry.cropAspect = 'Original';
    geometry.cropShapeKind = crop.shapeKind === 'selection' ? 'path' : crop.shapeKind;
    geometry.cropShapeRotation = crop.shapeRotation;
    geometry.cropShapeFeather = crop.shapeFeather;
    geometry.cropShapeRoundness = crop.shapeRoundness;
    geometry.cropShapePoints = crop.shapeKind === 'selection' ? crop.shapePoints : [];
    if (geometry.cropShapeKind === 'path' && geometry.cropShapePoints.length < 3) geometry.cropShapeKind = '';
    current.edits = E.migratedEdits(current.edits);
    pushHistory(crop.snapshot, current.edits, 'Crop photo');
    crop.snapshot = null;
    refreshControls();
    scheduleRender();
    debounceSave();
    if (toolMode === 'tool-crop') setTool('', { quiet: true });
    toast('Crop applied · reopen the Crop tool (C) any time — it stays non-destructive');
  }

  function cancel({ silent = false } = {}) {
    if (!crop.active) return;
    rail.cancelPendingDraft();
    finishState();
    if (current && current.id === crop.photoId && crop.snapshot) {
      current.edits = crop.snapshot;
      refreshControls();
      scheduleRender();
      debounceSave();
    }
    crop.snapshot = null;
    if (toolMode === 'tool-crop') setTool('', { quiet: true });
    if (!silent) toast('Crop canceled');
  }

  function normalizedRect() {
    const rect = crop.rect;
    return {
      l: clamp01(Math.min(rect.l, rect.r)), t: clamp01(Math.min(rect.t, rect.b)),
      r: clamp01(Math.max(rect.l, rect.r)), b: clamp01(Math.max(rect.t, rect.b))
    };
  }

  // ---------------------------------------------------------------------------
  // Options bar
  // ---------------------------------------------------------------------------

  function renderCropOptions() {
    const bar = $('#toolOptions');
    if (!bar || toolMode !== 'tool-crop') return;
    bar.replaceChildren();

    const title = document.createElement('b');
    title.className = 'tool-option-title';
    title.textContent = 'Crop';
    bar.append(title);

    bar.append(labelSpan('Aspect'));
    const aspect = document.createElement('select');
    aspect.setAttribute('aria-label', 'Crop aspect ratio');
    for (const [label] of RATIOS) {
      const option = document.createElement('option');
      option.value = label; option.textContent = label; option.selected = label === crop.ratioLabel;
      aspect.append(option);
    }
    aspect.onchange = () => applyAspect(aspect.value);
    bar.append(aspect);

    const swap = miniButton('⇄', 'Swap crop orientation (X)', swapOrientation);
    bar.append(swap);

    bar.append(labelSpan('Shape'));
    const shape = document.createElement('select');
    shape.setAttribute('aria-label', 'Crop shape');
    for (const kind of SHAPES) {
      const option = document.createElement('option');
      option.value = kind;
      option.textContent = kind === '' ? 'None' : kind === 'selection' ? 'From selection' : kind === 'rounded' ? 'rounded rect' : kind;
      option.selected = kind === crop.shapeKind;
      shape.append(option);
    }
    shape.onchange = () => setShape(shape.value);
    bar.append(shape);

    if (crop.shapeKind && crop.shapeKind !== 'selection') {
      bar.append(labelSpan('Rotate'));
      bar.append(rangeInput(-180, 180, crop.shapeRotation, value => { crop.shapeRotation = value; }, 'Shape rotation'));
    }
    if (['star', 'rounded'].includes(crop.shapeKind)) {
      bar.append(labelSpan('Roundness'));
      bar.append(rangeInput(0, 100, crop.shapeRoundness, value => { crop.shapeRoundness = value; }, 'Shape roundness'));
    }
    if (crop.shapeKind) {
      bar.append(labelSpan('Feather'));
      bar.append(rangeInput(0, 100, crop.shapeFeather, value => { crop.shapeFeather = value; }, 'Shape edge feather'));
    }

    bar.append(labelSpan('Straighten'));
    const straighten = rangeInput(-45, 45, current?.edits.geometry.straighten || 0, value => {
      if (!current) return;
      current.edits.geometry.straighten = value;
      catalogDirty = true;
      rail.requestDraft();
    }, 'Straighten', 0.1);
    straighten.id = 'cropStraightenRange';
    bar.append(straighten);

    bar.append(miniButton('Guides: ' + crop.guides, 'Cycle guide overlay (O)', () => { cycleGuides(); renderCropOptions(); }));
    bar.append(miniButton('Reset', 'Reset the crop to the full photo', resetRect));
    const cancelButton = miniButton('Cancel', 'Cancel crop (Esc)', () => cancel());
    cancelButton.classList.add('danger-quiet');
    bar.append(cancelButton);
    const applyButton = miniButton('✓ Apply', 'Apply crop (Enter)', apply);
    applyButton.classList.add('primary-quiet');
    bar.append(applyButton);
  }

  function labelSpan(text) {
    const span = document.createElement('span');
    span.className = 'tool-option-label';
    span.textContent = text;
    return span;
  }

  function miniButton(text, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-btn';
    button.textContent = text;
    button.title = title;
    button.onclick = onClick;
    return button;
  }

  function rangeInput(min, max, value, onInput, label, step = 1) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    input.setAttribute('aria-label', label);
    input.oninput = () => onInput(+input.value);
    return input;
  }

  function applyAspect(label) {
    crop.ratioLabel = label;
    const entry = RATIOS.find(([name]) => name === label);
    if (!entry || entry[1] == null) { crop.ratio = null; return; }
    const dims = frameDims();
    crop.ratio = entry[1] === 'original' ? dims.width / dims.height : entry[1];
    reshapeToRatio();
  }

  /** Re-fit the rect to the locked ratio around its center, as large as fits. */
  function reshapeToRatio() {
    if (!crop.ratio) return;
    const dims = frameDims();
    const rect = normalizedRect();
    const centerX = (rect.l + rect.r) / 2, centerY = (rect.t + rect.b) / 2;
    const widthPx = (rect.r - rect.l) * dims.width, heightPx = (rect.b - rect.t) * dims.height;
    let newWidthPx = Math.min(widthPx, heightPx * crop.ratio);
    let newHeightPx = newWidthPx / crop.ratio;
    if (newHeightPx > heightPx) { newHeightPx = heightPx; newWidthPx = newHeightPx * crop.ratio; }
    let halfW = newWidthPx / dims.width / 2, halfH = newHeightPx / dims.height / 2;
    const scaleDown = Math.min(1, 0.5 / Math.max(halfW, halfH));
    halfW *= scaleDown; halfH *= scaleDown;
    crop.rect = {
      l: clamp01(centerX - halfW) , t: clamp01(centerY - halfH),
      r: clamp01(centerX + halfW), b: clamp01(centerY + halfH)
    };
    nudgeRectInside();
  }

  function nudgeRectInside() {
    const rect = crop.rect;
    const width = rect.r - rect.l, height = rect.b - rect.t;
    if (rect.l < 0) { rect.l = 0; rect.r = width; }
    if (rect.t < 0) { rect.t = 0; rect.b = height; }
    if (rect.r > 1) { rect.r = 1; rect.l = 1 - width; }
    if (rect.b > 1) { rect.b = 1; rect.t = 1 - height; }
  }

  function swapOrientation() {
    if (crop.ratio) { crop.ratio = 1 / crop.ratio; reshapeToRatio(); renderCropOptions(); return; }
    const rect = normalizedRect();
    const centerX = (rect.l + rect.r) / 2, centerY = (rect.t + rect.b) / 2;
    const dims = frameDims();
    const widthPx = (rect.r - rect.l) * dims.width, heightPx = (rect.b - rect.t) * dims.height;
    let halfW = heightPx / dims.width / 2, halfH = widthPx / dims.height / 2;
    const scaleDown = Math.min(1, 0.5 / Math.max(halfW, halfH), centerX / halfW, (1 - centerX) / halfW, centerY / halfH, (1 - centerY) / halfH);
    halfW *= scaleDown; halfH *= scaleDown;
    crop.rect = { l: centerX - halfW, t: centerY - halfH, r: centerX + halfW, b: centerY + halfH };
  }

  function resetRect() {
    crop.rect = { l: 0, t: 0, r: 1, b: 1 };
    crop.ratio = null;
    crop.ratioLabel = 'Free';
    if (current) { current.edits.geometry.straighten = 0; rail.requestDraft(); }
    renderCropOptions();
  }

  function cycleGuides() {
    crop.guides = GUIDE_MODES[(GUIDE_MODES.indexOf(crop.guides) + 1) % GUIDE_MODES.length];
  }

  function setShape(kind) {
    crop.shapeKind = kind;
    if (kind === 'selection') {
      const points = selectionOutlinePoints();
      if (!points) {
        toast('Draw a Lasso, Marquee, or Pen selection first, then choose "From selection"');
        crop.shapeKind = '';
      } else {
        crop.shapePoints = points;
        toast('Crop shape taken from the active selection');
      }
    }
    renderCropOptions();
  }

  /**
   * Flatten the active geometry selection's outline into crop-rect-relative
   * points (bezier segments are sampled; shapes use their vertices).
   */
  function selectionOutlinePoints() {
    const mask = rail.activeGeometryMask();
    const region = mask?.regions?.find(entry => entry.kind === 'polygon' || entry.kind === 'bezier');
    if (!region) return null;
    // screenFromSourceMatrix with a 1×1 "display" maps source points straight to output fractions.
    const matrix = rail.screenFromSourceMatrix(prepared(), 1, 1);
    const outputPoints = [];
    const toOutput = (x, y) => { const point = matrix.transformPoint(new DOMPoint(x, y)); return { x: point.x, y: point.y }; };
    if (region.kind === 'polygon') {
      for (const point of region.points) outputPoints.push(toOutput(point[0], point[1]));
    } else {
      const points = region.points;
      const SAMPLES = Math.max(4, Math.min(24, Math.floor(480 / points.length)));
      for (let index = 0; index < points.length; index++) {
        const from = points[index], to = points[(index + 1) % points.length];
        for (let step = 0; step < SAMPLES; step++) {
          const t = step / SAMPLES, u = 1 - t;
          const x = u * u * u * from[0] + 3 * u * u * t * from[4] + 3 * u * t * t * to[2] + t * t * t * to[0];
          const y = u * u * u * from[1] + 3 * u * u * t * from[5] + 3 * u * t * t * to[3] + t * t * t * to[1];
          outputPoints.push({ x, y });
        }
      }
    }
    if (outputPoints.length < 3) return null;
    const rect = normalizedRect();
    const width = Math.max(1e-6, rect.r - rect.l), height = Math.max(1e-6, rect.b - rect.t);
    return outputPoints.slice(0, 512).map(point => [
      Math.max(-1, Math.min(2, (point.x - rect.l) / width)),
      Math.max(-1, Math.min(2, (point.y - rect.t) / height))
    ]);
  }

  // ---------------------------------------------------------------------------
  // Pointer interaction
  // ---------------------------------------------------------------------------

  function displayRect() { return rail.canvasDisplayRect(); }

  function screenRect() {
    const display = displayRect();
    if (!display) return null;
    const rect = normalizedRect();
    return {
      x: rect.l * display.width, y: rect.t * display.height,
      w: (rect.r - rect.l) * display.width, h: (rect.b - rect.t) * display.height,
      display
    };
  }

  function photoHandlePositions() {
    const display = displayRect();
    if (!display) return [];
    const matrix = rail.screenFromSourceMatrix(prepared(), display.width, display.height);
    return [
      { id: 'photo-nw', x: 0, y: 0, kind: 'photo-scale' }, { id: 'photo-ne', x: 1, y: 0, kind: 'photo-scale' },
      { id: 'photo-se', x: 1, y: 1, kind: 'photo-scale' }, { id: 'photo-sw', x: 0, y: 1, kind: 'photo-scale' },
      { id: 'photo-n', x: 0.5, y: 0, kind: 'photo-stretch-y' }, { id: 'photo-s', x: 0.5, y: 1, kind: 'photo-stretch-y' },
      { id: 'photo-w', x: 0, y: 0.5, kind: 'photo-stretch-x' }, { id: 'photo-e', x: 1, y: 0.5, kind: 'photo-stretch-x' }
    ].map(handle => {
      const point = matrix.transformPoint(new DOMPoint(handle.x, handle.y));
      return { ...handle, sx: point.x, sy: point.y };
    });
  }

  function onCanvasPointerDown(event) {
    const screen = screenRect();
    if (!screen) return false;
    const px = event.clientX - screen.display.left, py = event.clientY - screen.display.top;

    // Photo-frame handles (zoom / stretch the photo under the crop).
    const photoHandle = photoHandlePositions().find(handle => Math.hypot(px - handle.sx, py - handle.sy) <= 12);
    if (photoHandle) { beginPhotoGesture(event, photoHandle.kind, screen); return true; }

    // Inside the crop box, dragging pans the PHOTO under the crop; Ctrl moves the box itself.
    const inside = px >= screen.x && px <= screen.x + screen.w && py >= screen.y && py <= screen.y + screen.h;
    if (inside && event.ctrlKey) { beginRectGesture(event, 'move', screen); return true; }
    if (inside) { beginPhotoGesture(event, 'photo-pan', screen); return true; }
    beginStraightenGesture(event, screen);
    return true;
  }

  function beginRectGesture(event, part, screen) {
    crop.gesture = {
      kind: 'rect', part, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      startRect: { ...normalizedRect() }, screen,
      shiftRatio: null
    };
    bindWindowGesture();
  }

  function beginStraightenGesture(event, screen) {
    const centerX = screen.display.left + screen.x + screen.w / 2;
    const centerY = screen.display.top + screen.y + screen.h / 2;
    crop.gesture = {
      kind: 'straighten', pointerId: event.pointerId,
      centerX, centerY,
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      startStraighten: current.edits.geometry.straighten,
      before: E.clone(current.edits), photoId: current.id, moved: false
    };
    rail.beginCanvasWarp(crop.gesture);
    bindWindowGesture();
  }

  function beginPhotoGesture(event, part, screen) {
    const display = screen.display;
    const shim = prepared();
    const dims = frameDims();
    const metrics = E.geometryMetrics(dims.width, dims.height, shim);
    const matrix = rail.screenFromSourceMatrix(shim, display.width, display.height);
    const center = matrix.transformPoint(new DOMPoint(0.5, 0.5));
    const geometry = current.edits.geometry;
    crop.gesture = {
      kind: 'photo', part, pointerId: event.pointerId,
      startX: event.clientX - display.left, startY: event.clientY - display.top,
      center: { x: center.x, y: center.y },
      display, dims, metrics,
      axisX: frameAxis(matrix, 1, 0), axisY: frameAxis(matrix, 0, 1),
      startScale: geometry.scale, startStretchX: geometry.stretchX, startStretchY: geometry.stretchY,
      startXOffset: geometry.xOffset, startYOffset: geometry.yOffset,
      before: E.clone(current.edits), photoId: current.id, moved: false
    };
    rail.beginCanvasWarp(crop.gesture);
    bindWindowGesture();
  }

  function frameAxis(matrix, dx, dy) {
    const origin = matrix.transformPoint(new DOMPoint(0.5, 0.5));
    const tip = matrix.transformPoint(new DOMPoint(0.5 + dx * 0.01, 0.5 + dy * 0.01));
    const vx = tip.x - origin.x, vy = tip.y - origin.y;
    const length = Math.hypot(vx, vy) || 1e-6;
    return { x: vx / length, y: vy / length };
  }

  function beginHandleGesture(event, handleId) {
    const screen = screenRect();
    if (!screen) return;
    event.preventDefault();
    event.stopPropagation();
    beginRectGesture(event, handleId, screen);
  }

  let windowGestureBound = false;
  function bindWindowGesture() {
    if (windowGestureBound) return;
    windowGestureBound = true;
    window.addEventListener('pointermove', onWindowPointerMove, true);
    window.addEventListener('pointerup', onWindowPointerUp, true);
    window.addEventListener('pointercancel', onWindowPointerUp, true);
  }

  function onWindowPointerMove(event) {
    const gesture = crop.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    if (gesture.kind === 'rect') { moveRectGesture(event, gesture); return; }
    if (gesture.kind === 'straighten') { moveStraightenGesture(event, gesture); return; }
    if (gesture.kind === 'photo') { movePhotoGesture(event, gesture); return; }
  }

  function onWindowPointerUp(event) {
    const gesture = crop.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    crop.gesture = null;
    if (gesture.kind === 'straighten' || gesture.kind === 'photo') {
      rail.cancelPendingDraft();
      rail.endCanvasWarp(gesture);
      if (gesture.moved && current?.id === gesture.photoId) {
        // No history push here: everything between enter() and apply() lands in
        // the single "Crop photo" undo step (cancel restores the snapshot).
        clearPresetTracking();
        current.edits = E.migratedEdits(current.edits);
        refreshControls();
        debounceSave();
      }
      scheduleRender();
    }
  }

  function moveRectGesture(event, gesture) {
    const screen = gesture.screen;
    const dxFraction = (event.clientX - gesture.startX) / screen.display.width;
    const dyFraction = (event.clientY - gesture.startY) / screen.display.height;
    const start = gesture.startRect;
    const part = gesture.part;
    if (part === 'move') {
      const width = start.r - start.l, height = start.b - start.t;
      let left = clamp01(start.l + dxFraction); left = Math.min(left, 1 - width);
      let top = clamp01(start.t + dyFraction); top = Math.min(top, 1 - height);
      crop.rect = { l: left, t: top, r: left + width, b: top + height };
      return;
    }
    let { l, t, r, b } = start;
    if (part.includes('w')) l = clamp01(start.l + dxFraction);
    if (part.includes('e')) r = clamp01(start.r + dxFraction);
    if (part.includes('n')) t = clamp01(start.t + dyFraction);
    if (part.includes('s')) b = clamp01(start.b + dyFraction);
    if (r - l < MIN_RECT_FRACTION) { if (part.includes('w')) l = r - MIN_RECT_FRACTION; else r = l + MIN_RECT_FRACTION; }
    if (b - t < MIN_RECT_FRACTION) { if (part.includes('n')) t = b - MIN_RECT_FRACTION; else b = t + MIN_RECT_FRACTION; }

    const ratio = crop.ratio || (event.shiftKey ? lockedStartRatio(gesture) : null);
    if (ratio) {
      const dims = frameDims();
      const anchor = {
        x: part.includes('w') ? r : l,
        y: part.includes('n') ? b : t
      };
      const isCorner = part.length === 2;
      const widthPx = (r - l) * dims.width, heightPx = (b - t) * dims.height;
      let finalWidthPx, finalHeightPx;
      if (isCorner) {
        finalWidthPx = Math.min(widthPx, heightPx * ratio);
        finalHeightPx = finalWidthPx / ratio;
      } else if (part === 'e' || part === 'w') {
        finalWidthPx = widthPx; finalHeightPx = widthPx / ratio;
      } else {
        finalHeightPx = heightPx; finalWidthPx = heightPx * ratio;
      }
      let widthFraction = finalWidthPx / dims.width, heightFraction = finalHeightPx / dims.height;
      widthFraction = Math.max(MIN_RECT_FRACTION, widthFraction);
      heightFraction = Math.max(MIN_RECT_FRACTION, heightFraction);
      if (part === 'n' || part === 's') {
        const centerX = (start.l + start.r) / 2;
        l = centerX - widthFraction / 2; r = centerX + widthFraction / 2;
        if (part === 'n') t = b - heightFraction; else b = t + heightFraction;
      } else if (part === 'e' || part === 'w') {
        const centerY = (start.t + start.b) / 2;
        t = centerY - heightFraction / 2; b = centerY + heightFraction / 2;
        if (part === 'w') l = r - widthFraction; else r = l + widthFraction;
      } else {
        l = part.includes('w') ? anchor.x - widthFraction : anchor.x;
        r = part.includes('w') ? anchor.x : anchor.x + widthFraction;
        t = part.includes('n') ? anchor.y - heightFraction : anchor.y;
        b = part.includes('n') ? anchor.y : anchor.y + heightFraction;
      }
      // Clamp inside the frame while preserving the ratio.
      const overflowScale = Math.min(1,
        l < 0 ? (r) / (r - l) : 1, r > 1 ? (1 - l) / (r - l) : 1,
        t < 0 ? (b) / (b - t) : 1, b > 1 ? (1 - t) / (b - t) : 1);
      if (overflowScale < 1) {
        const anchorX = part.includes('w') ? r : l, anchorY = part.includes('n') ? b : t;
        const newWidth = (r - l) * overflowScale, newHeight = (b - t) * overflowScale;
        l = part.includes('w') ? anchorX - newWidth : anchorX;
        r = part.includes('w') ? anchorX : anchorX + newWidth;
        t = part.includes('n') ? anchorY - newHeight : anchorY;
        b = part.includes('n') ? anchorY : anchorY + newHeight;
      }
      l = clamp01(l); r = clamp01(r); t = clamp01(t); b = clamp01(b);
    }
    crop.rect = { l, t, r, b };
  }

  function lockedStartRatio(gesture) {
    if (gesture.shiftRatio) return gesture.shiftRatio;
    const dims = frameDims();
    const start = gesture.startRect;
    gesture.shiftRatio = ((start.r - start.l) * dims.width) / Math.max(1e-6, (start.b - start.t) * dims.height);
    return gesture.shiftRatio;
  }

  function moveStraightenGesture(event, gesture) {
    const angle = Math.atan2(event.clientY - gesture.centerY, event.clientX - gesture.centerX);
    let degrees = gesture.startStraighten + (angle - gesture.startAngle) * 180 / Math.PI;
    degrees = Math.max(-45, Math.min(45, degrees));
    current.edits.geometry.straighten = Math.round(degrees * 10) / 10;
    gesture.moved = true;
    catalogDirty = true;
    const delta = (current.edits.geometry.straighten - gesture.startStraighten) * Math.PI / 180;
    const painted = rail.drawCanvasWarp(gesture, (context, canvas) => {
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(delta);
      context.translate(-canvas.width / 2, -canvas.height / 2);
    });
    if (!painted) rail.requestDraft();
    const slider = $('#cropStraightenRange');
    if (slider) slider.value = String(current.edits.geometry.straighten);
  }

  function movePhotoGesture(event, gesture) {
    const geometry = current.edits.geometry;
    const px = event.clientX - gesture.display.left, py = event.clientY - gesture.display.top;
    gesture.moved = true;
    if (gesture.part === 'photo-pan') {
      const dxFraction = (px - gesture.startX) / gesture.display.width;
      const dyFraction = (py - gesture.startY) / gesture.display.height;
      geometry.xOffset = bounded(gesture.startXOffset + dxFraction * gesture.metrics.cw * 200 / gesture.dims.width, -100, 100);
      geometry.yOffset = bounded(gesture.startYOffset + dyFraction * gesture.metrics.ch * 200 / gesture.dims.height, -100, 100);
    } else if (gesture.part === 'photo-scale') {
      const startDistance = Math.hypot(gesture.startX - gesture.center.x, gesture.startY - gesture.center.y) || 1e-6;
      const distance = Math.hypot(px - gesture.center.x, py - gesture.center.y);
      geometry.scale = bounded(gesture.startScale * distance / startDistance, 10, 400);
    } else {
      const axis = gesture.part === 'photo-stretch-x' ? gesture.axisX : gesture.axisY;
      const startProjection = Math.abs((gesture.startX - gesture.center.x) * axis.x + (gesture.startY - gesture.center.y) * axis.y) || 1e-6;
      const projection = Math.abs((px - gesture.center.x) * axis.x + (py - gesture.center.y) * axis.y);
      const ratio = projection / startProjection;
      if (gesture.part === 'photo-stretch-x') geometry.stretchX = bounded(gesture.startStretchX * ratio, 25, 400);
      else geometry.stretchY = bounded(gesture.startStretchY * ratio, 25, 400);
    }
    catalogDirty = true;
    const canvasElement = $('#canvas');
    const scaleToBacking = canvasElement.width / gesture.display.width;
    const centerX = gesture.center.x * scaleToBacking, centerY = gesture.center.y * scaleToBacking;
    const painted = rail.drawCanvasWarp(gesture, context => {
      if (gesture.part === 'photo-pan') {
        const dx = (geometry.xOffset - gesture.startXOffset) / 200 * gesture.dims.width * (canvasElement.width / gesture.metrics.cw);
        const dy = (geometry.yOffset - gesture.startYOffset) / 200 * gesture.dims.height * (canvasElement.height / gesture.metrics.ch);
        context.translate(dx, dy);
      } else if (gesture.part === 'photo-scale') {
        const ratio = geometry.scale / gesture.startScale;
        context.translate(centerX, centerY);
        context.scale(ratio, ratio);
        context.translate(-centerX, -centerY);
      } else {
        const axis = gesture.part === 'photo-stretch-x' ? gesture.axisX : gesture.axisY;
        const ratio = gesture.part === 'photo-stretch-x' ? geometry.stretchX / gesture.startStretchX : geometry.stretchY / gesture.startStretchY;
        const angle = Math.atan2(axis.y, axis.x);
        context.translate(centerX, centerY);
        context.rotate(angle);
        context.scale(ratio, 1);
        context.rotate(-angle);
        context.translate(-centerX, -centerY);
      }
    });
    if (!painted) rail.requestDraft();
  }

  function bounded(value, min, max) { return Math.max(min, Math.min(max, value)); }

  // ---------------------------------------------------------------------------
  // DOM handles
  // ---------------------------------------------------------------------------

  function buildHandles() {
    const container = $handles();
    if (!container) return;
    container.replaceChildren(...HANDLE_IDS.map(id => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'crop-handle crop-handle-' + id;
      button.dataset.handle = id;
      button.setAttribute('aria-label', 'Crop handle ' + id.toUpperCase());
      button.addEventListener('pointerdown', event => beginHandleGesture(event, id));
      return button;
    }));
  }

  function positionHandles() {
    const container = $handles();
    if (!container || !crop.active) return;
    const screen = screenRect();
    if (!screen) return;
    const key = [screen.x, screen.y, screen.w, screen.h].map(value => Math.round(value)).join(',');
    if (key === crop.handleCache) return;
    crop.handleCache = key;
    const anchors = {
      nw: [screen.x, screen.y], n: [screen.x + screen.w / 2, screen.y], ne: [screen.x + screen.w, screen.y],
      e: [screen.x + screen.w, screen.y + screen.h / 2], se: [screen.x + screen.w, screen.y + screen.h],
      s: [screen.x + screen.w / 2, screen.y + screen.h], sw: [screen.x, screen.y + screen.h],
      w: [screen.x, screen.y + screen.h / 2]
    };
    container.querySelectorAll('.crop-handle').forEach(button => {
      const [x, y] = anchors[button.dataset.handle];
      button.style.left = x + 'px';
      button.style.top = y + 'px';
    });
  }

  // ---------------------------------------------------------------------------
  // Overlay painting (registered with the shared tool overlay)
  // ---------------------------------------------------------------------------

  function shapeOutlinePath(screen) {
    if (!crop.shapeKind) return null;
    if (crop.shapeKind === 'selection') {
      if (crop.shapePoints.length < 3) return null;
      const path = new Path2D();
      crop.shapePoints.forEach((point, index) => {
        const x = screen.x + point[0] * screen.w, y = screen.y + point[1] * screen.h;
        index ? path.lineTo(x, y) : path.moveTo(x, y);
      });
      path.closePath();
      return path;
    }
    const kind = crop.shapeKind === 'oval' ? 'ellipse' : crop.shapeKind;
    return E.shapePath(kind, screen.x + screen.w / 2, screen.y + screen.h / 2, screen.w, screen.h, crop.shapeRotation, crop.shapeRoundness);
  }

  function paintCrop(context, { rect: displayBox }) {
    if (!crop.active || !current) return false;
    const screen = screenRect();
    if (!screen) return false;
    positionHandles();

    // Dim everything outside the crop (or outside the crop shape).
    const scrim = new Path2D();
    scrim.rect(0, 0, displayBox.width, displayBox.height);
    const inner = shapeOutlinePath(screen) || (() => { const path = new Path2D(); path.rect(screen.x, screen.y, screen.w, screen.h); return path; })();
    scrim.addPath(inner);
    context.save();
    context.fillStyle = 'rgba(10,11,13,0.62)';
    context.fill(scrim, 'evenodd');
    context.restore();

    // Crop border.
    context.save();
    context.strokeStyle = '#fff';
    context.lineWidth = 1.5;
    context.strokeRect(screen.x, screen.y, screen.w, screen.h);
    if (crop.shapeKind) {
      context.strokeStyle = 'rgba(240,163,91,0.95)';
      context.setLineDash([6, 4]);
      context.stroke(inner);
      context.setLineDash([]);
    }

    // Guides.
    context.strokeStyle = 'rgba(255,255,255,0.35)';
    context.lineWidth = 1;
    if (crop.guides === 'thirds' || crop.guides === 'golden') {
      const fractions = crop.guides === 'thirds' ? [1 / 3, 2 / 3] : [0.382, 0.618];
      for (const fraction of fractions) {
        line(context, screen.x + screen.w * fraction, screen.y, screen.x + screen.w * fraction, screen.y + screen.h);
        line(context, screen.x, screen.y + screen.h * fraction, screen.x + screen.w, screen.y + screen.h * fraction);
      }
    } else if (crop.guides === 'grid') {
      for (let index = 1; index < 6; index++) {
        const fraction = index / 6;
        line(context, screen.x + screen.w * fraction, screen.y, screen.x + screen.w * fraction, screen.y + screen.h);
        line(context, screen.x, screen.y + screen.h * fraction, screen.x + screen.w, screen.y + screen.h * fraction);
      }
    }

    // Photo frame + its transform handles.
    context.strokeStyle = 'rgba(114,168,255,0.8)';
    const photoHandles = photoHandlePositions();
    const corners = photoHandles.filter(handle => handle.kind === 'photo-scale');
    context.beginPath();
    corners.forEach((corner, index) => index ? context.lineTo(corner.sx, corner.sy) : context.moveTo(corner.sx, corner.sy));
    context.closePath();
    context.stroke();
    for (const handle of photoHandles) {
      context.beginPath();
      context.fillStyle = handle.kind === 'photo-scale' ? '#72a8ff' : '#fff';
      context.strokeStyle = 'rgba(0,0,0,0.7)';
      context.arc(handle.sx, handle.sy, 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();
    return true;
  }

  function line(context, x0, y0, x1, y1) {
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
  }

  // ---------------------------------------------------------------------------
  // Keyboard + router registration
  // ---------------------------------------------------------------------------

  function handleCropKeys(event) {
    if (!crop.active) return false;
    const key = event.key;
    if (key === 'Enter') { apply(); return true; }
    if (key === 'Escape') { cancel(); return true; }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const lower = String(key).toLowerCase();
    if (lower === 'o') { cycleGuides(); renderCropOptions(); return true; }
    if (lower === 'x') { swapOrientation(); return true; }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(lower) && document.activeElement === $('#canvas')) {
      const step = event.shiftKey ? 0.05 : 0.01;
      const dx = lower === 'arrowleft' ? -step : lower === 'arrowright' ? step : 0;
      const dy = lower === 'arrowup' ? -step : lower === 'arrowdown' ? step : 0;
      const width = crop.rect.r - crop.rect.l, height = crop.rect.b - crop.rect.t;
      crop.rect.l = Math.max(0, Math.min(1 - width, crop.rect.l + dx));
      crop.rect.t = Math.max(0, Math.min(1 - height, crop.rect.t + dy));
      crop.rect.r = crop.rect.l + width;
      crop.rect.b = crop.rect.t + height;
      return true;
    }
    return false;
  }

  function route(type, event) {
    if (type === 'enter') { enter(); return true; }
    if (type === 'exit') { if (crop.active) apply(); return true; }
    if (!crop.active) return false;
    if (type === 'pointerdown') return onCanvasPointerDown(event);
    if (type === 'dblclick') { apply(); return true; }
    return false;
  }

  buildHandles();
  rail.registerCropRouter(route);
  rail.registerKeyHandler(handleCropKeys);
  rail.registerOverlayPainter(paintCrop);
  rail.registerOptionsProvider('crop', renderCropOptions);

  /** Public surface for tests and app integration. */
  globalThis.LumaCropTool = {
    state: crop,
    isActive: () => crop.active,
    enter, apply, cancel,
    setRect(l, t, r, b) { crop.rect = { l, t, r, b }; },
    setShape,
    setAspect: applyAspect
  };
})();
