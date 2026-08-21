/**
 * Luma Darkroom — Tool rail and on-canvas selection tools.
 *
 * Adds a vertical tool rail, a contextual options bar, and the interactive
 * selection tools (marquee, lasso, polygonal lasso, magic wand, pen) plus the
 * Move/Transform tool used to pan, zoom, and stretch the photo underneath a
 * crop — following the single-key shortcuts and modifier conventions that
 * professional photo editors expect. Selections become non-destructive
 * "geometry" mask layers (see engine.js `type:'geometry'` / `regions[]`), so
 * every selection supports the full set of local adjustments, feathering,
 * invert, and brush refinement.
 *
 * This file loads AFTER app.js and integrates through the shared global scope:
 * it wraps `setTool` (the same monkey-patch pattern app.js itself uses for
 * `updateMaskUI`) and listens on the capture phase of #canvasWrap so it can
 * consume pointer events before app.js' own canvas handlers run.
 */
(() => {
  'use strict';

  /** Tool modes owned by this module (kept distinct from app.js modes). */
  const RAIL_TOOL_MODES = ['tool-move', 'tool-marquee', 'tool-lasso', 'tool-wand', 'tool-pen', 'tool-crop', 'tool-zoom', 'tool-hand'];

  /** Marching-ants + handle styling shared by every overlay painter. */
  const OVERLAY_STYLE = {
    antsDash: [5, 4],
    antsSpeed: 0.35,           // dash-offset px per frame
    handleSize: 9,             // CSS px
    handleHitRadius: 11,
    anchorSize: 7,
    accent: '#f0a35b',
    accentSoft: 'rgba(240,163,91,0.85)',
    frame: 'rgba(255,255,255,0.9)'
  };

  const MIN_DRAG_PX = 4;                // below this a marquee/lasso drag is ignored
  const CLOSE_SNAP_PX = 10;             // polygon / pen click-to-close distance
  const LASSO_SIMPLIFY_PX = 1.75;       // Ramer–Douglas–Peucker epsilon (screen px)
  const DRAFT_RENDER_INTERVAL = 80;     // ms between draft renders while dragging
  const MAX_LASSO_RAW_POINTS = 6000;    // raw pointer samples kept before simplify

  /** Mutable module state. */
  const state = {
    combine: 'new',                      // options bar: new | add | subtract | intersect
    marqueeVariant: 'rect',              // rect | ellipse | shape
    marqueeShape: 'star',
    shapeRoundness: 40,
    lassoVariant: 'freehand',            // freehand | polygonal
    gradientVariant: 'linear',
    wandTolerance: 30,
    wandContiguous: true,
    gesture: null,                       // active pointer drag (marquee/lasso/transform/hand/anchor)
    pending: null,                       // multi-click path in progress (polygonal lasso / pen)
    selectedAnchor: null,                // {regionIndex, pointIndex} for pen editing
    antsOffset: 0,
    instructedTools: new Set(),          // tool hints toast once per session
    overlayPainters: [],                 // extra painters (crop tool registers here)
    keyHandlers: [],                     // extra key handlers (crop tool registers here)
    lastDraftAt: 0,
    draftTimer: null,
    overlaySize: { width: 0, height: 0, dpr: 1 }
  };

  const $rail = () => $('#toolRail');
  const $options = () => $('#toolOptions');
  const $overlay = () => $('#toolOverlay');
  const $canvas = () => $('#canvas');
  const $wrap = () => $('#canvasWrap');

  // ---------------------------------------------------------------------------
  // Tool registry
  // ---------------------------------------------------------------------------

  const TOOLS = [
    { id: 'move', key: 'V', name: 'Move / Transform', hint: 'Drag the photo to pan it. Drag corners to zoom, edges to stretch.', mode: 'tool-move' },
    { id: 'marquee', key: 'M', name: 'Marquee select', hint: 'Drag a rectangle, ellipse, or preset shape. Shift adds, Alt subtracts.', mode: 'tool-marquee' },
    { id: 'lasso', key: 'L', name: 'Lasso select', hint: 'Draw a freehand or polygonal selection.', mode: 'tool-lasso' },
    { id: 'wand', key: 'W', name: 'Auto select (wand)', hint: 'Click a color to select similar pixels. Adjust tolerance in the bar above.', mode: 'tool-wand' },
    { id: 'pen', key: 'P', name: 'Pen (vector select)', hint: 'Click for corners, drag for curves. Click the first point or press Enter to close.', mode: 'tool-pen' },
    { id: 'brush', key: 'B', name: 'Mask brush', mode: 'mask-add', activate: () => { switchRightPanel('mask'); activateMaskBrush('mask-add', { force: true }); } },
    { id: 'eraser', key: 'E', name: 'Mask eraser', mode: 'mask-subtract', activate: () => { if (!activeMask()) { toast('Create or choose a mask before using the Eraser'); return; } switchRightPanel('mask'); setTool('mask-subtract', { force: true }); } },
    { id: 'gradient', key: 'G', name: 'Gradient mask', mode: 'mask-linear', matches: mode => mode === 'mask-linear' || mode === 'mask-radial', activate: () => activateGradientTool(false) },
    { id: 'crop', key: 'C', name: 'Crop & shape crop', hint: 'Drag the handles. Enter applies, Esc cancels, O cycles guides, X swaps the aspect.', mode: 'tool-crop' },
    { id: 'eyedropper', key: 'I', name: 'Color sampler', mode: 'color', activate: () => setTool('color', { force: true }) },
    { id: 'heal', key: 'J', name: 'Heal / retouch', mode: 'cleanup', matches: mode => RETOUCH_TOOLS.includes(mode), activate: () => { switchRightPanel('mask'); setTool('cleanup', { force: true }); } },
    { id: 'zoom', key: 'Z', name: 'Zoom', hint: 'Click to zoom in, Alt+click to zoom out, double-click to fit.', mode: 'tool-zoom' },
    { id: 'hand', key: 'H', name: 'Hand (pan)', hint: 'Drag to pan the zoomed photo.', mode: 'tool-hand' }
  ];

  function toolById(id) { return TOOLS.find(tool => tool.id === id); }

  function activateGradientTool(cycle) {
    if (!current) return;
    if (cycle) state.gradientVariant = state.gradientVariant === 'linear' ? 'radial' : 'linear';
    const active = activeMask();
    switchRightPanel('mask');
    if (active && (active.type === 'linear' || active.type === 'radial') && !cycle) {
      setTool('mask-' + active.type, { force: true });
      return;
    }
    addMaskAndActivate(state.gradientVariant);
  }

  // ---------------------------------------------------------------------------
  // Rail + options bar rendering
  // ---------------------------------------------------------------------------

  /**
   * Monochrome stroke icons (16×16, currentColor) for the tool rail.
   * Inline SVG keeps them crisp at any DPI and theme-colored for free.
   */
  const svgIcon = body => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const TOOL_ICONS = {
    move: svgIcon('<path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2"/>'),
    marquee: svgIcon('<rect x="2" y="3.5" width="12" height="9" rx="1" stroke-dasharray="2.6 2"/>'),
    lasso: svgIcon('<path d="M8 2.2c3.7 0 6.2 1.7 6.2 4s-2.8 4.2-6.2 4.2c-.9 0-1.8-.1-2.6-.3M1.8 6.2c0-2.3 2.5-4 6.2-4M1.8 6.2c0 1.5 1.3 2.8 3.6 3.9M5.4 10.1c.8 1-.2 2.3-1.7 3.4M5.4 10.1c-.5.7-.2 1.3.4 1.5"/>'),
    wand: svgIcon('<path d="M2.5 13.5 8.5 7.5" stroke-width="1.8"/><path d="M11 1.8v2.8M9.6 3.2h2.8M13.6 6.2v2M12.6 7.2h2M9.8 10.9v1.6M9 11.7h1.6"/>'),
    pen: svgIcon('<path d="M8 1.6c1.9 2.6 3.6 5 3.6 7a3.6 3.6 0 1 1-7.2 0c0-2 1.7-4.4 3.6-7Z"/><circle cx="8" cy="8.8" r="1.1"/><path d="M8 9.9v4.4"/>'),
    brush: svgIcon('<path d="M13.8 2.2 8.6 7.9"/><path d="M8.6 7.9c-1.6-.4-3.2.6-3.5 2.2-.2 1.1-.6 1.9-1.9 2.5 1.4 1 3.8 1.2 5.2 0 1.2-1 1.6-2.9.2-4.7Z"/>'),
    eraser: svgIcon('<path d="m9.3 2.6 4.1 3.2-6 7.7H3.6l-1.7-1.4 7.4-9.5Z"/><path d="m6.1 6.7 4.1 3.2M7.4 13.5h6.1"/>'),
    gradient: svgIcon('<rect x="2" y="3.5" width="12" height="9" rx="1"/><path d="M4.4 5.5v5" opacity=".95"/><path d="M6.8 5.5v5" opacity=".65"/><path d="M9.2 5.5v5" opacity=".4"/><path d="M11.6 5.5v5" opacity=".2"/>'),
    crop: svgIcon('<path d="M4.5 1.5v10h10M1.5 4.5h10v10"/>'),
    eyedropper: svgIcon('<path d="M2 14c1.6-.1 1.8-.7 2.5-1.4l5-5-1.1-1.1-5 5C2.7 12.2 2.1 12.4 2 14Z"/><path d="m8.2 5.3 2.5 2.5M13.6 5.2a1.9 1.9 0 0 0-2.7-2.7L9.5 3.9l2.7 2.7 1.4-1.4Z"/>'),
    heal: svgIcon('<rect x="1.6" y="5.4" width="12.8" height="5.2" rx="2.6" transform="rotate(-45 8 8)"/><path d="M8 6.5v3M6.5 8h3"/>'),
    zoom: svgIcon('<circle cx="7" cy="7" r="4.6"/><path d="m10.5 10.5 3.6 3.6M7 5.2v3.6M5.2 7h3.6"/>'),
    hand: svgIcon('<path d="M5.6 14c-1.5-1.4-3-3.4-3.3-4.9-.2-.9 1-1.5 1.7-.7l1 1.2V4.3c0-1.2 1.7-1.2 1.7 0v3.4-4.5c0-1.2 1.7-1.2 1.7 0v4.5-3.9c0-1.2 1.7-1.2 1.7 0v4.2-2.9c0-1.1 1.6-1.1 1.6 0v4.6c0 2.6-1.6 4.3-4 4.3-1.4 0-2.4-.4-3.1-1Z"/>')
  };

  function buildRail() {
    const rail = $rail();
    if (!rail) return;
    rail.replaceChildren(...TOOLS.map(tool => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool-rail-btn';
      button.dataset.toolId = tool.id;
      button.title = `${tool.name} (${tool.key})`;
      button.setAttribute('aria-label', `${tool.name}, shortcut ${tool.key}`);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = TOOL_ICONS[tool.id] || '';
      button.onclick = () => activateTool(tool.id);
      return button;
    }));
  }

  function activateTool(id, { cycleVariant = false } = {}) {
    const tool = toolById(id);
    if (!tool || !current || view !== 'edit') return;
    if (cycleVariant) {
      if (id === 'marquee') state.marqueeVariant = state.marqueeVariant === 'rect' ? 'ellipse' : state.marqueeVariant === 'ellipse' ? 'shape' : 'rect';
      if (id === 'lasso') state.lassoVariant = state.lassoVariant === 'freehand' ? 'polygonal' : 'freehand';
    }
    if (tool.activate) { tool.activate(cycleVariant); return; }
    setTool(tool.mode, { force: true });
  }

  function isToolActive(tool) {
    if (tool.matches) return tool.matches(toolMode);
    return toolMode === tool.mode;
  }

  function syncRail() {
    const rail = $rail();
    if (!rail) return;
    rail.querySelectorAll('.tool-rail-btn').forEach(button => {
      const tool = toolById(button.dataset.toolId);
      const active = !!tool && isToolActive(tool);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  /** Segmented control helper for the options bar. */
  function segment(label, entries, selected, onPick) {
    const group = document.createElement('div');
    group.className = 'tool-segment';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    for (const [value, text, title] of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      if (title) button.title = title;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(value === selected));
      button.classList.toggle('active', value === selected);
      button.onclick = () => { onPick(value); renderOptions(); };
      group.append(button);
    }
    return group;
  }

  function optionLabel(text) {
    const span = document.createElement('span');
    span.className = 'tool-option-label';
    span.textContent = text;
    return span;
  }

  function combineControl() {
    return segment('Selection combine mode', [
      ['new', 'New', 'Replaces the active selection (its adjustments stay)'],
      ['add', 'Add', 'Add to the active selection (Shift while drawing)'],
      ['subtract', 'Subtract', 'Remove from the active selection (Alt while drawing)'],
      ['intersect', 'Intersect', 'Keep only the overlap (Shift+Alt while drawing)']
    ], state.combine, value => { state.combine = value; });
  }

  /** ＋ button in the selection tools' options bar — the explicit "new layer" action. */
  function newSelectionLayerButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-btn';
    button.id = 'newSelectionLayerBtn';
    button.textContent = '＋ New layer';
    button.title = 'Add a separate Selection mask layer (drawing alone never adds layers)';
    button.onclick = () => addSelectionLayer();
    return button;
  }

  const optionsProviders = new Map();
  function renderOptions() {
    const bar = $options();
    if (!bar) return;
    bar.replaceChildren();
    const tool = TOOLS.find(entry => isToolActive(entry));
    bar.classList.toggle('hidden', view !== 'edit');
    if (tool && optionsProviders.has(tool.id)) { optionsProviders.get(tool.id)(bar); return; }
    if (!tool) {
      const hint = document.createElement('span');
      hint.className = 'tool-option-hint';
      hint.textContent = current ? 'Pick a tool from the rail (V M L W P B E G C I J Z H) — or press ? for all shortcuts.' : 'Import a photo to start editing.';
      bar.append(hint);
      return;
    }
    const title = document.createElement('b');
    title.className = 'tool-option-title';
    title.textContent = tool.name;
    bar.append(title);

    if (tool.id === 'marquee') {
      bar.append(combineControl(), newSelectionLayerButton());
      bar.append(segment('Marquee shape', [['rect', '▭ Rect'], ['ellipse', '◯ Ellipse'], ['shape', '★ Shape']], state.marqueeVariant, value => { state.marqueeVariant = value; }));
      if (state.marqueeVariant === 'shape') {
        bar.append(optionLabel('Shape'));
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Preset shape');
        for (const kind of E.SHAPE_KINDS) {
          const option = document.createElement('option');
          option.value = kind;
          option.textContent = kind === 'rounded' ? 'rounded rect' : kind;
          option.selected = kind === state.marqueeShape;
          select.append(option);
        }
        select.onchange = () => { state.marqueeShape = select.value; };
        bar.append(select);
        bar.append(optionLabel('Roundness'));
        const roundness = document.createElement('input');
        roundness.type = 'range'; roundness.min = '0'; roundness.max = '100'; roundness.value = String(state.shapeRoundness);
        roundness.setAttribute('aria-label', 'Shape roundness (star point depth, corner radius)');
        roundness.oninput = () => { state.shapeRoundness = +roundness.value; };
        bar.append(roundness);
      }
      bar.append(hintSpan('Shift while dragging keeps it square · Alt draws from the center.'));
    } else if (tool.id === 'lasso') {
      bar.append(combineControl(), newSelectionLayerButton());
      bar.append(segment('Lasso mode', [['freehand', '∿ Freehand'], ['polygonal', '⟋ Polygonal']], state.lassoVariant, value => { state.lassoVariant = value; cancelPending(); }));
      bar.append(hintSpan(state.lassoVariant === 'freehand' ? 'Draw around the area; release to close.' : 'Click to place points · Enter or double-click closes · Backspace removes the last point.'));
    } else if (tool.id === 'wand') {
      bar.append(combineControl(), newSelectionLayerButton());
      bar.append(optionLabel('Tolerance'));
      const tolerance = document.createElement('input');
      tolerance.type = 'range'; tolerance.min = '0'; tolerance.max = '100'; tolerance.value = String(state.wandTolerance);
      tolerance.setAttribute('aria-label', 'Wand tolerance');
      const toleranceOut = document.createElement('output');
      toleranceOut.textContent = String(state.wandTolerance);
      tolerance.oninput = () => { state.wandTolerance = +tolerance.value; toleranceOut.textContent = tolerance.value; };
      bar.append(tolerance, toleranceOut);
      const contiguous = document.createElement('label');
      contiguous.className = 'tool-check';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.checked = state.wandContiguous;
      check.onchange = () => { state.wandContiguous = check.checked; };
      contiguous.append(check, document.createTextNode('Contiguous'));
      bar.append(contiguous);
      const aiSubject = document.createElement('button');
      aiSubject.type = 'button'; aiSubject.className = 'mini-btn'; aiSubject.textContent = '◉ AI Subject';
      aiSubject.title = 'AI subject selection (click the subject on the photo)';
      aiSubject.onclick = () => beginSmartObjectSelection('', { name: 'Subject', type: 'subject', kind: 'subject' });
      const aiObject = document.createElement('button');
      aiObject.type = 'button'; aiObject.className = 'mini-btn'; aiObject.textContent = '◈ AI Object';
      aiObject.title = 'AI object selection (click any object on the photo)';
      aiObject.onclick = () => beginSmartObjectSelection('', { name: 'Object', type: 'object', kind: 'object' });
      bar.append(aiSubject, aiObject);
    } else if (tool.id === 'pen') {
      bar.append(combineControl(), newSelectionLayerButton());
      bar.append(hintSpan('Click = corner point · click-drag = curve · click the first point or Enter closes · with a closed path, drag anchors and handles to refine.'));
    } else if (tool.id === 'move') {
      const reset = document.createElement('button');
      reset.type = 'button'; reset.className = 'mini-btn'; reset.textContent = 'Reset position';
      reset.title = 'Reset pan, zoom, and stretch of the photo inside the crop';
      reset.onclick = () => commit('Reset photo position', () => {
        const geometry = current.edits.geometry;
        geometry.scale = 100; geometry.stretchX = 100; geometry.stretchY = 100; geometry.xOffset = 0; geometry.yOffset = 0;
      });
      bar.append(reset, hintSpan(tool.hint));
    } else if (tool.hint) {
      bar.append(hintSpan(tool.hint));
    }
  }

  function hintSpan(text) {
    const span = document.createElement('span');
    span.className = 'tool-option-hint';
    span.textContent = text;
    return span;
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers (screen ⇄ source)
  // ---------------------------------------------------------------------------

  function orientedDims(edits) {
    const rotation = ((edits.geometry.rotation90 % 360) + 360) % 360;
    const swap = rotation === 90 || rotation === 270;
    const naturalWidth = sourceImage.naturalWidth || 1;
    const naturalHeight = sourceImage.naturalHeight || 1;
    return { width: swap ? naturalHeight : naturalWidth, height: swap ? naturalWidth : naturalHeight };
  }

  /** DOMMatrix mapping source-normalized (0..1) points onto overlay CSS pixels. */
  function screenFromSourceMatrix(prepared, displayWidth, displayHeight) {
    const dims = orientedDims(prepared);
    const g = E.geometryMetrics(dims.width, dims.height, prepared);
    return new DOMMatrix()
      .scaleSelf(displayWidth / g.cw, displayHeight / g.ch)
      .translateSelf(-g.cx, -g.cy)
      .translateSelf(g.tx, g.ty)
      .rotateSelf(g.theta * 180 / Math.PI)
      .multiplySelf(new DOMMatrix([g.a, g.b, g.c, g.d, 0, 0]))
      .translateSelf(-dims.width / 2, -dims.height / 2)
      .scaleSelf(dims.width, dims.height);
  }

  function canvasDisplayRect() {
    const canvas = $canvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  /** Pointer event → output-space fraction over the displayed canvas (unclamped). */
  function pointerFraction(event) {
    const rect = canvasDisplayRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  function clamp01(value) { return Math.max(0, Math.min(1, value)); }

  /** Convert an output-space rect into a source-space shape region (exact under the affine). */
  function shapeRegionFromOutputRect(shape, rect, prepared, roundness) {
    const dims = orientedDims(prepared);
    const centerX = (rect.x0 + rect.x1) / 2, centerY = (rect.y0 + rect.y1) / 2;
    const halfW = Math.abs(rect.x1 - rect.x0) / 2, halfH = Math.abs(rect.y1 - rect.y0) / 2;
    const eps = 0.01;
    const center = E.outputPointToSourcePrepared(sourceImage, prepared, clamp01(centerX), clamp01(centerY));
    const probeX = E.outputPointToSourcePrepared(sourceImage, prepared, clamp01(centerX + (centerX > 0.5 ? -eps : eps)), clamp01(centerY));
    const probeY = E.outputPointToSourcePrepared(sourceImage, prepared, clamp01(centerX), clamp01(centerY + (centerY > 0.5 ? -eps : eps)));
    const directionX = centerX > 0.5 ? -1 : 1, directionY = centerY > 0.5 ? -1 : 1;
    const dxX = (probeX.x - center.x) * dims.width * directionX, dxY = (probeX.y - center.y) * dims.height * directionX;
    const dyX = (probeY.x - center.x) * dims.width * directionY, dyY = (probeY.y - center.y) * dims.height * directionY;
    const perEpsX = Math.hypot(dxX, dxY) / eps, perEpsY = Math.hypot(dyX, dyY) / eps;
    const wFrac = Math.max(0.001, Math.min(2, 2 * perEpsX * halfW / dims.width));
    const hFrac = Math.max(0.001, Math.min(2, 2 * perEpsY * halfH / dims.height));
    const rotation = Math.atan2(dxY, dxX) * 180 / Math.PI;
    return { kind: 'shape', shape, cx: center.x, cy: center.y, w: wFrac, h: hFrac, rotation, roundness };
  }

  /** Ramer–Douglas–Peucker simplification on screen-space points. */
  function simplifyPath(points, epsilon) {
    if (points.length <= 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [start, end] = stack.pop();
      let maxDistance = 0, index = -1;
      const ax = points[start].sx, ay = points[start].sy, bx = points[end].sx, by = points[end].sy;
      const length = Math.hypot(bx - ax, by - ay) || 1e-6;
      for (let i = start + 1; i < end; i++) {
        const distance = Math.abs((by - ay) * points[i].sx - (bx - ax) * points[i].sy + bx * ay - by * ax) / length;
        if (distance > maxDistance) { maxDistance = distance; index = i; }
      }
      if (maxDistance > epsilon && index > 0) { keep[index] = 1; stack.push([start, index], [index, end]); }
    }
    return points.filter((_, i) => keep[i]);
  }

  // ---------------------------------------------------------------------------
  // Selection commit
  // ---------------------------------------------------------------------------

  function combineFromEvent(event) {
    if (event.shiftKey && event.altKey) return 'intersect';
    if (event.shiftKey) return 'add';
    if (event.altKey) return 'subtract';
    return state.combine;
  }

  /**
   * Route a drawn region into the active selection mask.
   *
   * Standard pro-editor semantics: with combine "new" the drawn shape
   * REPLACES the active selection's regions (its adjustments, feather, and
   * brush refinements stay); add/subtract/intersect append with that mode.
   * Drawing never creates additional mask layers — the only bootstrap case
   * is the very first selection when no selection mask is active. New layers
   * come from the explicit ＋ controls (see addSelectionLayer).
   */
  function commitRegion(region, combine, label) {
    if (!current) return false;
    const active = activeMask();
    const activeGeometry = active?.type === 'geometry' ? active : null;
    if (!activeGeometry && current.edits.masks.layers.length >= MAX_MASK_LAYERS) {
      toast('A photo can have up to ' + MAX_MASK_LAYERS + ' local masks');
      return false;
    }
    const replacing = combine === 'new' && !!activeGeometry && (activeGeometry.regions || []).length > 0;
    const mode = combine === 'subtract' ? 'subtract' : combine === 'intersect' ? 'intersect' : 'add';
    commit(replacing ? 'New selection' : label, () => {
      let layer = activeGeometry ? activeMask() : null;
      if (!layer) {
        const id = uid();
        layer = E.defaultMaskLayer({ id, name: uniqueMaskName('Selection'), type: 'geometry', space: 'source', show: true, feather: 0 });
        current.edits.masks.layers.unshift(layer);
        current.edits.masks.activeId = id;
      }
      layer.enabled = true;
      layer.regions = replacing ? [{ ...region, mode: 'add' }] : [...(layer.regions || []), { ...region, mode }];
    });
    switchRightPanel('mask');
    return true;
  }

  /**
   * Explicitly add a fresh, empty Selection mask layer (the ＋ actions).
   * Keeps the current selection tool active, or arms the lasso.
   */
  function addSelectionLayer() {
    if (!current) return null;
    if (current.edits.masks.layers.length >= MAX_MASK_LAYERS) {
      toast('A photo can have up to ' + MAX_MASK_LAYERS + ' local masks');
      return null;
    }
    const id = uid();
    commit('Add selection layer', () => {
      const layer = E.defaultMaskLayer({ id, name: uniqueMaskName('Selection'), type: 'geometry', space: 'source', show: true, feather: 0 });
      current.edits.masks.layers.unshift(layer);
      current.edits.masks.activeId = id;
    }, { render: false });
    switchRightPanel('mask');
    if (!['tool-marquee', 'tool-lasso', 'tool-wand', 'tool-pen'].includes(toolMode)) setTool('tool-lasso', { force: true });
    toast('New selection layer · draw on the photo to shape it');
    return activeMask();
  }

  function activeGeometryMask() {
    const mask = activeMask();
    return mask?.type === 'geometry' ? mask : null;
  }

  // ---------------------------------------------------------------------------
  // Pointer gestures
  // ---------------------------------------------------------------------------

  /**
   * Lightweight stand-in for `E.migratedEdits(current.edits)` for coordinate
   * math: `geometryMetrics` and the point-transform helpers only read
   * `geometry` and `optics`, and every value this module writes is already
   * clamped, so re-sanitizing the whole edit document (including large AI
   * mask payloads) each frame would be wasted work.
   */
  function preparedNow() { return { geometry: current.edits.geometry, optics: current.edits.optics }; }

  function requestDraft() {
    const now = performance.now();
    if (now - state.lastDraftAt >= DRAFT_RENDER_INTERVAL) {
      state.lastDraftAt = now;
      scheduleRender({ draft: true, preserveCanvas: true });
      return;
    }
    if (!state.draftTimer) {
      state.draftTimer = setTimeout(() => {
        state.draftTimer = null;
        state.lastDraftAt = performance.now();
        scheduleRender({ draft: true, preserveCanvas: true });
      }, DRAFT_RENDER_INTERVAL);
    }
  }

  /**
   * Drop any queued draft render. MUST be called before the full-quality
   * render at the end of a gesture, or the stale draft can land after it
   * and leave the preview soft (same rule the brush pipeline follows).
   */
  function cancelPendingDraft() {
    if (state.draftTimer) { clearTimeout(state.draftTimer); state.draftTimer = null; }
  }

  function consumesPointer() {
    return RAIL_TOOL_MODES.includes(toolMode) && !spacePanActive;
  }

  function onPointerDown(event) {
    if (!current || view !== 'edit' || event.target !== $canvas() || !consumesPointer()) return;
    if (event.button !== 0) return;
    if (toolMode === 'tool-crop') { if (routeCrop('pointerdown', event)) consume(event); return; }
    const fraction = pointerFraction(event);
    if (!fraction) return;
    const rect = canvasDisplayRect();
    const screen = { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
    consume(event);
    $wrap().setPointerCapture?.(event.pointerId);

    if (toolMode === 'tool-hand') {
      state.gesture = { kind: 'hand', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: $wrap().scrollLeft, top: $wrap().scrollTop };
      $wrap().classList.add('panning');
      return;
    }
    if (toolMode === 'tool-zoom') {
      state.gesture = { kind: 'zoom-click', pointerId: event.pointerId, alt: event.altKey };
      return;
    }
    if (toolMode === 'tool-move') { beginTransformGesture(event, fraction, rect); return; }
    if (toolMode === 'tool-marquee') {
      state.gesture = {
        kind: 'marquee', pointerId: event.pointerId, combine: combineFromEvent(event),
        start: fraction, currentPoint: fraction, rect, prepared: preparedNow(),
        variant: state.marqueeVariant, shape: state.marqueeVariant === 'shape' ? state.marqueeShape : state.marqueeVariant
      };
      return;
    }
    if (toolMode === 'tool-lasso' && state.lassoVariant === 'freehand') {
      state.gesture = { kind: 'lasso', pointerId: event.pointerId, combine: combineFromEvent(event), rect, prepared: preparedNow(), points: [{ ...fraction, ...screen }] };
      return;
    }
    if (toolMode === 'tool-lasso' && state.lassoVariant === 'polygonal') { addPendingPoint('polygon', event, fraction, screen); return; }
    if (toolMode === 'tool-pen') { beginPenPointer(event, fraction, screen); return; }
    if (toolMode === 'tool-wand') {
      const prepared = preparedNow();
      const source = E.outputPointToSourcePrepared(sourceImage, prepared, clamp01(fraction.x), clamp01(fraction.y));
      commitRegion({ kind: 'wand', x: source.x, y: source.y, tolerance: state.wandTolerance, contiguous: state.wandContiguous }, combineFromEvent(event), 'Wand selection');
      return;
    }
  }

  function onPointerMove(event) {
    const gesture = state.gesture;
    if (toolMode === 'tool-crop' && !gesture) { routeCrop('pointermove', event); return; }
    if (!gesture || event.pointerId !== gesture.pointerId) {
      if (state.pending && event.target === $canvas()) {
        const fraction = pointerFraction(event);
        const rect = canvasDisplayRect();
        if (fraction && rect) state.pending.hover = { ...fraction, sx: event.clientX - rect.left, sy: event.clientY - rect.top };
      }
      return;
    }
    consume(event);
    if (gesture.kind === 'crop') { routeCrop('pointermove', event); return; }
    if (gesture.kind === 'hand') {
      $wrap().scrollLeft = gesture.left - (event.clientX - gesture.startX);
      $wrap().scrollTop = gesture.top - (event.clientY - gesture.startY);
      return;
    }
    const fraction = pointerFraction(event);
    if (!fraction) return;
    if (gesture.kind === 'marquee') { gesture.currentPoint = fraction; gesture.constrain = event.shiftKey; gesture.fromCenter = event.altKey; return; }
    if (gesture.kind === 'lasso') {
      const rect = gesture.rect;
      for (const sample of (typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event])) {
        if (gesture.points.length >= MAX_LASSO_RAW_POINTS) break;
        const sampleFraction = pointerFraction(sample);
        if (!sampleFraction) continue;
        const screenPoint = { sx: sample.clientX - rect.left, sy: sample.clientY - rect.top };
        const last = gesture.points[gesture.points.length - 1];
        if (Math.hypot(screenPoint.sx - last.sx, screenPoint.sy - last.sy) >= 1.25) gesture.points.push({ ...sampleFraction, ...screenPoint });
      }
      return;
    }
    if (gesture.kind === 'transform') { moveTransformGesture(event, fraction); return; }
    if (gesture.kind === 'anchor') { moveAnchorGesture(event, fraction); return; }
    if (gesture.kind === 'pen-drag') {
      const point = state.pending?.points[state.pending.points.length - 1];
      if (point) {
        point.hox = fraction.x; point.hoy = fraction.y;
        point.hix = 2 * point.ax - fraction.x; point.hiy = 2 * point.ay - fraction.y;
        point.smooth = true;
      }
      return;
    }
  }

  function onPointerUp(event) {
    const gesture = state.gesture;
    if (toolMode === 'tool-crop' && !gesture) { if (routeCrop('pointerup', event)) consume(event); return; }
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    consume(event);
    state.gesture = null;
    try { $wrap().releasePointerCapture?.(event.pointerId); } catch { /* released already */ }
    if (gesture.kind === 'crop') { routeCrop('pointerup', event); return; }
    if (gesture.kind === 'hand') { $wrap().classList.remove('panning'); return; }
    if (gesture.kind === 'zoom-click') {
      const zoomValue = +($('#zoomRange')?.value || 100);
      applyZoom(gesture.alt ? zoomValue - 25 : zoomValue + 25);
      return;
    }
    if (gesture.kind === 'marquee') { finishMarquee(gesture); return; }
    if (gesture.kind === 'lasso') { finishLasso(gesture); return; }
    if (gesture.kind === 'transform') { finishTransformGesture(gesture); return; }
    if (gesture.kind === 'anchor') { finishAnchorGesture(gesture); return; }
    if (gesture.kind === 'pen-drag') { state.pending?.points.length && requestDraftlessRepaint(); return; }
  }

  function onPointerCancel(event) {
    const gesture = state.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    state.gesture = null;
    $wrap().classList.remove('panning');
    if (gesture.kind === 'transform') {
      endCanvasWarp(gesture);
      if (gesture.before && current?.id === gesture.photoId) {
        current.edits = gesture.before;
        refreshControls();
        scheduleRender();
      }
    }
    if (gesture.kind === 'crop') routeCrop('pointercancel', event);
  }

  function onDoubleClick(event) {
    if (!current || view !== 'edit' || event.target !== $canvas()) return;
    if (toolMode === 'tool-zoom') { consume(event); applyZoom(100); return; }
    if (toolMode === 'tool-crop') { if (routeCrop('dblclick', event)) consume(event); return; }
    if (state.pending) { consume(event); closePending(); }
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function requestDraftlessRepaint() { /* overlay repaints every frame; hook kept for clarity */ }

  // --- Marquee -------------------------------------------------------------

  function finishMarquee(gesture) {
    const rect = gesture.rect;
    let x0 = gesture.start.x, y0 = gesture.start.y, x1 = gesture.currentPoint.x, y1 = gesture.currentPoint.y;
    if (gesture.fromCenter) { x0 = gesture.start.x * 2 - x1; y0 = gesture.start.y * 2 - y1; }
    if (gesture.constrain) {
      const size = Math.max(Math.abs(x1 - x0) * rect.width, Math.abs(y1 - y0) * rect.height);
      x1 = x0 + Math.sign(x1 - x0 || 1) * size / rect.width;
      y1 = y0 + Math.sign(y1 - y0 || 1) * size / rect.height;
    }
    if (Math.abs(x1 - x0) * rect.width < MIN_DRAG_PX || Math.abs(y1 - y0) * rect.height < MIN_DRAG_PX) return;
    const shape = gesture.variant === 'rect' ? 'rect' : gesture.variant === 'ellipse' ? 'ellipse' : gesture.shape;
    const region = shapeRegionFromOutputRect(shape, { x0, y0, x1, y1 }, gesture.prepared, state.shapeRoundness);
    const label = gesture.variant === 'shape' ? 'Shape selection' : gesture.variant === 'ellipse' ? 'Ellipse selection' : 'Rectangle selection';
    commitRegion(region, gesture.combine, label);
  }

  // --- Lasso ---------------------------------------------------------------

  function finishLasso(gesture) {
    if (gesture.points.length < 3) return;
    const simplified = simplifyPath(gesture.points, LASSO_SIMPLIFY_PX);
    if (simplified.length < 3) return;
    const points = simplified.map(point => {
      const source = E.outputPointToSourcePrepared(sourceImage, gesture.prepared, clamp01(point.x), clamp01(point.y));
      return [source.x, source.y];
    });
    commitRegion({ kind: 'polygon', points }, gesture.combine, 'Lasso selection');
  }

  // --- Polygonal lasso + pen (multi-click pending paths) -------------------

  function addPendingPoint(kind, event, fraction, screen) {
    if (!state.pending) {
      state.pending = { kind, combine: combineFromEvent(event), prepared: preparedNow(), points: [], hover: null };
    }
    const pending = state.pending;
    const first = pending.points[0];
    if (first && Math.hypot(screen.sx - first.sx, screen.sy - first.sy) <= CLOSE_SNAP_PX && pending.points.length >= 3) {
      closePending();
      return;
    }
    pending.points.push(kind === 'pen'
      ? { ax: fraction.x, ay: fraction.y, hix: fraction.x, hiy: fraction.y, hox: fraction.x, hoy: fraction.y, smooth: false, sx: screen.sx, sy: screen.sy }
      : { x: fraction.x, y: fraction.y, sx: screen.sx, sy: screen.sy });
  }

  function beginPenPointer(event, fraction, screen) {
    const mask = activeGeometryMask();
    if (!state.pending && mask) {
      const hit = hitTestAnchor(screen);
      if (hit) { beginAnchorGesture(event, hit); return; }
    }
    addPendingPoint('pen', event, fraction, screen);
    if (state.pending) state.gesture = { kind: 'pen-drag', pointerId: event.pointerId };
  }

  function closePending() {
    const pending = state.pending;
    state.pending = null;
    if (!pending || pending.points.length < 3) return;
    if (pending.kind === 'polygon') {
      const points = pending.points.map(point => {
        const source = E.outputPointToSourcePrepared(sourceImage, pending.prepared, clamp01(point.x), clamp01(point.y));
        return [source.x, source.y];
      });
      commitRegion({ kind: 'polygon', points }, pending.combine, 'Polygon selection');
      return;
    }
    const points = pending.points.map(point => {
      const anchor = E.outputPointToSourcePrepared(sourceImage, pending.prepared, clamp01(point.ax), clamp01(point.ay));
      const inHandle = E.outputPointToSourcePrepared(sourceImage, pending.prepared, clamp01(point.hix), clamp01(point.hiy));
      const outHandle = E.outputPointToSourcePrepared(sourceImage, pending.prepared, clamp01(point.hox), clamp01(point.hoy));
      return [anchor.x, anchor.y, inHandle.x, inHandle.y, outHandle.x, outHandle.y];
    });
    commitRegion({ kind: 'bezier', points }, pending.combine, 'Pen selection');
  }

  function cancelPending() {
    state.pending = null;
    state.gesture = state.gesture?.kind === 'pen-drag' ? null : state.gesture;
  }

  function removeLastPendingPoint() {
    const pending = state.pending;
    if (!pending) return false;
    pending.points.pop();
    if (!pending.points.length) state.pending = null;
    return true;
  }

  // --- Pen anchor editing --------------------------------------------------

  function bezierRegionsOfActiveMask() {
    const mask = activeGeometryMask();
    if (!mask) return [];
    return (mask.regions || []).map((region, index) => ({ region, index })).filter(entry => entry.region.kind === 'bezier');
  }

  function anchorScreenPositions() {
    if (!current) return [];
    const rect = canvasDisplayRect();
    if (!rect) return [];
    const prepared = preparedNow();
    const matrix = screenFromSourceMatrix(prepared, rect.width, rect.height);
    const positions = [];
    for (const { region, index } of bezierRegionsOfActiveMask()) {
      region.points.forEach((point, pointIndex) => {
        const mapped = matrix.transformPoint(new DOMPoint(point[0], point[1]));
        const inHandle = matrix.transformPoint(new DOMPoint(point[2], point[3]));
        const outHandle = matrix.transformPoint(new DOMPoint(point[4], point[5]));
        positions.push({ regionIndex: index, pointIndex, x: mapped.x, y: mapped.y, inX: inHandle.x, inY: inHandle.y, outX: outHandle.x, outY: outHandle.y });
      });
    }
    return positions;
  }

  function hitTestAnchor(screen) {
    const selected = state.selectedAnchor;
    for (const position of anchorScreenPositions()) {
      const isSelected = selected && selected.regionIndex === position.regionIndex && selected.pointIndex === position.pointIndex;
      if (isSelected) {
        if (Math.hypot(screen.sx - position.outX, screen.sy - position.outY) <= OVERLAY_STYLE.handleHitRadius) return { ...position, part: 'out' };
        if (Math.hypot(screen.sx - position.inX, screen.sy - position.inY) <= OVERLAY_STYLE.handleHitRadius) return { ...position, part: 'in' };
      }
      if (Math.hypot(screen.sx - position.x, screen.sy - position.y) <= OVERLAY_STYLE.handleHitRadius) return { ...position, part: 'anchor' };
    }
    return null;
  }

  function beginAnchorGesture(event, hit) {
    state.selectedAnchor = { regionIndex: hit.regionIndex, pointIndex: hit.pointIndex };
    state.gesture = {
      kind: 'anchor', pointerId: event.pointerId, part: hit.part,
      regionIndex: hit.regionIndex, pointIndex: hit.pointIndex,
      before: E.clone(current.edits), photoId: current.id, prepared: preparedNow(), moved: false
    };
  }

  function moveAnchorGesture(event, fraction) {
    const gesture = state.gesture;
    const mask = activeGeometryMask();
    const region = mask?.regions?.[gesture.regionIndex];
    const point = region?.points?.[gesture.pointIndex];
    if (!point) return;
    const source = E.outputPointToSourcePrepared(sourceImage, gesture.prepared, clamp01(fraction.x), clamp01(fraction.y));
    gesture.moved = true;
    if (gesture.part === 'anchor') {
      const dx = source.x - point[0], dy = source.y - point[1];
      point[0] = source.x; point[1] = source.y;
      point[2] += dx; point[3] += dy; point[4] += dx; point[5] += dy;
    } else if (gesture.part === 'out') {
      point[4] = source.x; point[5] = source.y;
      if (!event.altKey) { point[2] = 2 * point[0] - source.x; point[3] = 2 * point[1] - source.y; }
    } else {
      point[2] = source.x; point[3] = source.y;
      if (!event.altKey) { point[4] = 2 * point[0] - source.x; point[5] = 2 * point[1] - source.y; }
    }
    catalogDirty = true;
    requestDraft();
  }

  function finishAnchorGesture(gesture) {
    cancelPendingDraft();
    if (!gesture.moved || current?.id !== gesture.photoId) return;
    current.edits = E.migratedEdits(current.edits);
    pushHistory(gesture.before, current.edits, 'Edit pen selection');
    refreshControls();
    scheduleRender();
    debounceSave();
  }

  // --- Move / Transform ----------------------------------------------------

  const TRANSFORM_HANDLES = [
    { id: 'nw', x: 0, y: 0, kind: 'scale' }, { id: 'ne', x: 1, y: 0, kind: 'scale' },
    { id: 'se', x: 1, y: 1, kind: 'scale' }, { id: 'sw', x: 0, y: 1, kind: 'scale' },
    { id: 'n', x: 0.5, y: 0, kind: 'stretch-y' }, { id: 's', x: 0.5, y: 1, kind: 'stretch-y' },
    { id: 'w', x: 0, y: 0.5, kind: 'stretch-x' }, { id: 'e', x: 1, y: 0.5, kind: 'stretch-x' }
  ];

  function transformFramePoints(prepared, rect) {
    const matrix = screenFromSourceMatrix(prepared, rect.width, rect.height);
    return TRANSFORM_HANDLES.map(handle => {
      const point = matrix.transformPoint(new DOMPoint(handle.x, handle.y));
      return { ...handle, sx: point.x, sy: point.y };
    });
  }

  function beginTransformGesture(event, fraction, rect) {
    const prepared = preparedNow();
    const screen = { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
    const handles = transformFramePoints(prepared, rect);
    const hit = handles.find(handle => Math.hypot(screen.sx - handle.sx, screen.sy - handle.sy) <= OVERLAY_STYLE.handleHitRadius + 2);
    const matrix = screenFromSourceMatrix(prepared, rect.width, rect.height);
    const center = matrix.transformPoint(new DOMPoint(0.5, 0.5));
    const dims = orientedDims(prepared);
    const g = E.geometryMetrics(dims.width, dims.height, prepared);
    const geometry = current.edits.geometry;
    state.gesture = {
      kind: 'transform', pointerId: event.pointerId, photoId: current.id,
      before: E.clone(current.edits), prepared, rect, metrics: g, dims,
      part: hit ? hit.kind : 'pan', center: { x: center.x, y: center.y },
      startScreen: screen, startFraction: fraction,
      startScale: geometry.scale, startStretchX: geometry.stretchX, startStretchY: geometry.stretchY,
      startXOffset: geometry.xOffset, startYOffset: geometry.yOffset,
      axisX: normalizedAxis(matrix, 1, 0), axisY: normalizedAxis(matrix, 0, 1), moved: false
    };
    beginCanvasWarp(state.gesture);
  }

  /** 60fps geometry-drag preview: redraw the snapshot under the delta transform. */
  function drawTransformWarp(gesture) {
    const canvas = $canvas();
    if (!canvas) return;
    const geometry = current.edits.geometry;
    const scaleToBacking = canvas.width / gesture.rect.width;
    const centerX = gesture.center.x * scaleToBacking, centerY = gesture.center.y * scaleToBacking;
    const painted = drawCanvasWarp(gesture, context => {
      if (gesture.part === 'pan') {
        const dx = (geometry.xOffset - gesture.startXOffset) / 200 * gesture.dims.width * (canvas.width / gesture.metrics.cw);
        const dy = (geometry.yOffset - gesture.startYOffset) / 200 * gesture.dims.height * (canvas.height / gesture.metrics.ch);
        context.translate(dx, dy);
      } else if (gesture.part === 'scale') {
        const ratio = geometry.scale / gesture.startScale;
        context.translate(centerX, centerY);
        context.scale(ratio, ratio);
        context.translate(-centerX, -centerY);
      } else {
        const axis = gesture.part === 'stretch-x' ? gesture.axisX : gesture.axisY;
        const ratio = gesture.part === 'stretch-x' ? geometry.stretchX / gesture.startStretchX : geometry.stretchY / gesture.startStretchY;
        const angle = Math.atan2(axis.y, axis.x);
        context.translate(centerX, centerY);
        context.rotate(angle);
        context.scale(ratio, 1);
        context.rotate(-angle);
        context.translate(-centerX, -centerY);
      }
    });
    if (!painted) requestDraft();
  }

  function normalizedAxis(matrix, dx, dy) {
    const origin = matrix.transformPoint(new DOMPoint(0.5, 0.5));
    const tip = matrix.transformPoint(new DOMPoint(0.5 + dx * 0.01, 0.5 + dy * 0.01));
    const vx = tip.x - origin.x, vy = tip.y - origin.y;
    const length = Math.hypot(vx, vy) || 1e-6;
    return { x: vx / length, y: vy / length };
  }

  function moveTransformGesture(event, fraction) {
    const gesture = state.gesture;
    const rect = gesture.rect;
    const screen = { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
    const geometry = current.edits.geometry;
    gesture.moved = true;
    if (gesture.part === 'pan') {
      const dxFraction = fraction.x - gesture.startFraction.x;
      const dyFraction = fraction.y - gesture.startFraction.y;
      geometry.xOffset = clampRange(gesture.startXOffset + dxFraction * gesture.metrics.cw * 200 / gesture.dims.width, -100, 100);
      geometry.yOffset = clampRange(gesture.startYOffset + dyFraction * gesture.metrics.ch * 200 / gesture.dims.height, -100, 100);
    } else if (gesture.part === 'scale') {
      const startDistance = Math.hypot(gesture.startScreen.sx - gesture.center.x, gesture.startScreen.sy - gesture.center.y) || 1e-6;
      const distance = Math.hypot(screen.sx - gesture.center.x, screen.sy - gesture.center.y);
      geometry.scale = clampRange(gesture.startScale * distance / startDistance, 10, 400);
    } else {
      const axis = gesture.part === 'stretch-x' ? gesture.axisX : gesture.axisY;
      const startProjection = Math.abs((gesture.startScreen.sx - gesture.center.x) * axis.x + (gesture.startScreen.sy - gesture.center.y) * axis.y) || 1e-6;
      const projection = Math.abs((screen.sx - gesture.center.x) * axis.x + (screen.sy - gesture.center.y) * axis.y);
      const ratio = projection / startProjection;
      if (gesture.part === 'stretch-x') geometry.stretchX = clampRange(gesture.startStretchX * ratio, 25, 400);
      else geometry.stretchY = clampRange(gesture.startStretchY * ratio, 25, 400);
    }
    catalogDirty = true;
    drawTransformWarp(gesture);
  }

  function clampRange(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function finishTransformGesture(gesture) {
    cancelPendingDraft();
    endCanvasWarp(gesture);
    if (!gesture.moved || current?.id !== gesture.photoId) { scheduleRender(); return; }
    clearPresetTracking();
    current.edits = E.migratedEdits(current.edits);
    pushHistory(gesture.before, current.edits, 'Transform photo');
    refreshControls();
    scheduleRender();
    debounceSave();
  }

  // ---------------------------------------------------------------------------
  // Overlay rendering (marching ants, previews, handles)
  // ---------------------------------------------------------------------------

  function positionOverlay() {
    const overlay = $overlay();
    const rect = canvasDisplayRect();
    if (!overlay || !rect) return null;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.round(rect.width), height = Math.round(rect.height);
    if (state.overlaySize.width !== width || state.overlaySize.height !== height || state.overlaySize.dpr !== dpr) {
      overlay.width = Math.max(1, Math.round(width * dpr));
      overlay.height = Math.max(1, Math.round(height * dpr));
      overlay.style.width = width + 'px';
      overlay.style.height = height + 'px';
      state.overlaySize = { width, height, dpr };
    }
    return { rect, dpr };
  }

  function regionScreenPath(region, matrix, dims) {
    if (region.kind === 'shape') {
      const local = E.shapePath(region.shape, region.cx * dims.width, region.cy * dims.height, region.w * dims.width, region.h * dims.height, region.rotation, region.roundness);
      if (!local) return null;
      const path = new Path2D();
      const pixelMatrix = matrix.multiply(new DOMMatrix().scaleSelf(1 / dims.width, 1 / dims.height));
      path.addPath(local, pixelMatrix);
      return path;
    }
    if (!Array.isArray(region.points) || region.points.length < 3) return null;
    const path = new Path2D();
    if (region.kind === 'bezier') {
      const points = region.points;
      const first = matrix.transformPoint(new DOMPoint(points[0][0], points[0][1]));
      path.moveTo(first.x, first.y);
      for (let index = 1; index <= points.length; index++) {
        const previous = points[index - 1], point = points[index % points.length];
        const c1 = matrix.transformPoint(new DOMPoint(previous[4], previous[5]));
        const c2 = matrix.transformPoint(new DOMPoint(point[2], point[3]));
        const anchor = matrix.transformPoint(new DOMPoint(point[0], point[1]));
        path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, anchor.x, anchor.y);
      }
      path.closePath();
      return path;
    }
    if (region.kind === 'polygon') {
      region.points.forEach((point, index) => {
        const mapped = matrix.transformPoint(new DOMPoint(point[0], point[1]));
        index ? path.lineTo(mapped.x, mapped.y) : path.moveTo(mapped.x, mapped.y);
      });
      path.closePath();
      return path;
    }
    return null;
  }

  /**
   * Marching-ants Path2D cache. Building screen paths for large lasso
   * polygons every animation frame is the main overlay cost, so paths are
   * cached against the regions array identity (sanitization replaces the
   * array on every edit) plus the current screen matrix.
   */
  const antsCache = new WeakMap();
  function antsPathsFor(regions, matrix, dims, displayWidth, displayHeight) {
    const key = [displayWidth, displayHeight, matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
      .map(value => Math.round(value * 100) / 100).join(',');
    const cached = antsCache.get(regions);
    if (cached && cached.key === key) return cached;
    const entry = { key, paths: [], seeds: [] };
    for (const region of regions) {
      if (region.kind === 'wand') {
        const seed = matrix.transformPoint(new DOMPoint(region.x, region.y));
        entry.seeds.push({ x: seed.x, y: seed.y });
        continue;
      }
      const path = regionScreenPath(region, matrix, dims);
      if (path) entry.paths.push(path);
    }
    antsCache.set(regions, entry);
    return entry;
  }

  /**
   * Live canvas-warp preview for geometry drags: instead of re-rendering the
   * pipeline on every pointer move, snapshot the current preview once and
   * redraw it under a 2D transform, then do one real render on release.
   */
  function beginCanvasWarp(holder) {
    const canvas = $canvas();
    if (!canvas) return;
    holder.warp = { bitmap: null, width: canvas.width, height: canvas.height };
    createImageBitmap(canvas).then(bitmap => {
      if (holder.warp && !holder.warp.bitmap && holder.warp.width === canvas.width) holder.warp.bitmap = bitmap;
      else bitmap.close();
    }).catch(() => {});
  }
  function drawCanvasWarp(holder, applyTransform) {
    const canvas = $canvas(), warp = holder.warp;
    if (!canvas || !warp || !warp.bitmap || canvas.width !== warp.width || canvas.height !== warp.height) return false;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    applyTransform(context, canvas);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(warp.bitmap, 0, 0);
    context.restore();
    return true;
  }
  function endCanvasWarp(holder) {
    holder.warp?.bitmap?.close?.();
    if (holder.warp) holder.warp.bitmap = null;
  }

  function strokeAnts(context, path) {
    context.save();
    context.lineWidth = 1.25;
    context.strokeStyle = 'rgba(0,0,0,0.85)';
    context.setLineDash([]);
    context.stroke(path);
    context.strokeStyle = '#fff';
    context.setLineDash(OVERLAY_STYLE.antsDash);
    context.lineDashOffset = -state.antsOffset;
    context.stroke(path);
    context.restore();
  }

  function drawHandle(context, x, y, { round = false, active = false } = {}) {
    const size = OVERLAY_STYLE.handleSize;
    context.save();
    context.fillStyle = active ? OVERLAY_STYLE.accent : '#fff';
    context.strokeStyle = 'rgba(0,0,0,0.7)';
    context.lineWidth = 1;
    if (round) {
      context.beginPath();
      context.arc(x, y, size / 2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else {
      context.fillRect(x - size / 2, y - size / 2, size, size);
      context.strokeRect(x - size / 2, y - size / 2, size, size);
    }
    context.restore();
  }

  function paintOverlay() {
    const overlay = $overlay();
    if (!overlay) return;
    if (!current || view !== 'edit') { overlay.classList.add('hidden'); return; }
    const mightDraw = state.gesture || state.pending || state.overlayPainters.length
      || activeGeometryMask() || ['tool-move', 'tool-pen', 'tool-crop'].includes(toolMode);
    if (!mightDraw) { overlay.classList.add('hidden'); return; }
    const placed = positionOverlay();
    if (!placed) { overlay.classList.add('hidden'); return; }
    const context = overlay.getContext('2d');
    context.setTransform(placed.dpr, 0, 0, placed.dpr, 0, 0);
    context.clearRect(0, 0, state.overlaySize.width, state.overlaySize.height);

    let drewSomething = false;
    const rect = placed.rect;
    const prepared = preparedNow();
    const matrix = screenFromSourceMatrix(prepared, rect.width, rect.height);
    const dims = orientedDims(prepared);

    // Marching ants around the active geometry selection (paths cached).
    const geometryMask = activeGeometryMask();
    if (geometryMask && geometryMask.regions?.length) {
      const ants = antsPathsFor(geometryMask.regions, matrix, dims, rect.width, rect.height);
      for (const seed of ants.seeds) { drawHandle(context, seed.x, seed.y, { round: true, active: true }); drewSomething = true; }
      for (const path of ants.paths) { strokeAnts(context, path); drewSomething = true; }
    }

    // Pen anchors + handles.
    if (toolMode === 'tool-pen' && geometryMask) {
      for (const position of anchorScreenPositions()) {
        const isSelected = state.selectedAnchor && state.selectedAnchor.regionIndex === position.regionIndex && state.selectedAnchor.pointIndex === position.pointIndex;
        if (isSelected) {
          context.save();
          context.strokeStyle = OVERLAY_STYLE.accentSoft;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(position.inX, position.inY);
          context.lineTo(position.x, position.y);
          context.lineTo(position.outX, position.outY);
          context.stroke();
          context.restore();
          drawHandle(context, position.inX, position.inY, { round: true });
          drawHandle(context, position.outX, position.outY, { round: true });
        }
        drawHandle(context, position.x, position.y, { active: isSelected });
        drewSomething = true;
      }
    }

    // In-progress gestures.
    const gesture = state.gesture;
    if (gesture?.kind === 'marquee') { drawMarqueePreview(context, gesture, rect); drewSomething = true; }
    if (gesture?.kind === 'lasso' && gesture.points.length > 1) {
      const path = new Path2D();
      gesture.points.forEach((point, index) => index ? path.lineTo(point.sx, point.sy) : path.moveTo(point.sx, point.sy));
      strokeAnts(context, path);
      drewSomething = true;
    }
    if (state.pending) { drawPendingPreview(context); drewSomething = true; }

    // Move/Transform frame.
    if (toolMode === 'tool-move') {
      const framePath = new Path2D();
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => matrix.transformPoint(new DOMPoint(x, y)));
      corners.forEach((corner, index) => index ? framePath.lineTo(corner.x, corner.y) : framePath.moveTo(corner.x, corner.y));
      framePath.closePath();
      context.save();
      context.strokeStyle = OVERLAY_STYLE.frame;
      context.lineWidth = 1.5;
      context.stroke(framePath);
      context.restore();
      for (const handle of transformFramePoints(prepared, rect)) drawHandle(context, handle.sx, handle.sy, { round: handle.kind !== 'scale' });
      drewSomething = true;
    }

    // Extra painters (crop tool).
    for (const painter of state.overlayPainters) {
      try { if (painter(context, { rect, matrix, dims, prepared })) drewSomething = true; }
      catch (error) { console.warn('[Luma] Overlay painter failed', error); }
    }

    overlay.classList.toggle('hidden', !drewSomething);
  }

  function drawMarqueePreview(context, gesture, rect) {
    let x0 = gesture.start.x, y0 = gesture.start.y, x1 = gesture.currentPoint.x, y1 = gesture.currentPoint.y;
    if (gesture.fromCenter) { x0 = gesture.start.x * 2 - x1; y0 = gesture.start.y * 2 - y1; }
    if (gesture.constrain) {
      const size = Math.max(Math.abs(x1 - x0) * rect.width, Math.abs(y1 - y0) * rect.height);
      x1 = x0 + Math.sign(x1 - x0 || 1) * size / rect.width;
      y1 = y0 + Math.sign(y1 - y0 || 1) * size / rect.height;
    }
    const left = Math.min(x0, x1) * rect.width, top = Math.min(y0, y1) * rect.height;
    const width = Math.abs(x1 - x0) * rect.width, height = Math.abs(y1 - y0) * rect.height;
    const shape = gesture.variant === 'rect' ? 'rect' : gesture.variant === 'ellipse' ? 'ellipse' : gesture.shape;
    const path = E.shapePath(shape, left + width / 2, top + height / 2, width, height, 0, state.shapeRoundness) || new Path2D();
    strokeAnts(context, path);
  }

  function drawPendingPreview(context) {
    const pending = state.pending;
    const path = new Path2D();
    if (pending.kind === 'polygon') {
      pending.points.forEach((point, index) => index ? path.lineTo(point.sx, point.sy) : path.moveTo(point.sx, point.sy));
      if (pending.hover) path.lineTo(pending.hover.sx, pending.hover.sy);
    } else {
      const points = pending.points;
      if (!points.length) return;
      const rect = canvasDisplayRect();
      if (!rect) return;
      const toScreen = point => ({ x: point[0] * rect.width, y: point[1] * rect.height });
      const screenPoints = points.map(point => ({ a: toScreen([point.ax, point.ay]), i: toScreen([point.hix, point.hiy]), o: toScreen([point.hox, point.hoy]) }));
      path.moveTo(screenPoints[0].a.x, screenPoints[0].a.y);
      for (let index = 1; index < screenPoints.length; index++) {
        const previous = screenPoints[index - 1], point = screenPoints[index];
        path.bezierCurveTo(previous.o.x, previous.o.y, point.i.x, point.i.y, point.a.x, point.a.y);
      }
      if (pending.hover) {
        const last = screenPoints[screenPoints.length - 1];
        path.bezierCurveTo(last.o.x, last.o.y, pending.hover.sx, pending.hover.sy, pending.hover.sx, pending.hover.sy);
      }
      for (const point of screenPoints) drawHandle(context, point.a.x, point.a.y);
    }
    strokeAnts(context, path);
    const first = pending.points[0];
    if (first) drawHandle(context, first.sx ?? first.a?.x, first.sy ?? first.a?.y, { round: true, active: true });
  }

  let overlayFrameToggle = false;
  function overlayLoop() {
    // Idle ants animate at half rate (~30fps); interactions paint every frame.
    overlayFrameToggle = !overlayFrameToggle;
    const interactive = state.gesture || state.pending || toolMode === 'tool-move' || toolMode === 'tool-crop';
    if (interactive || overlayFrameToggle) {
      state.antsOffset = (state.antsOffset + OVERLAY_STYLE.antsSpeed * (interactive ? 1 : 2)) % 18;
      try { paintOverlay(); }
      catch (error) { console.warn('[Luma] Tool overlay paint failed', error); }
    }
    requestAnimationFrame(overlayLoop);
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts (capture phase so app.js' handler defers via defaultPrevented)
  // ---------------------------------------------------------------------------

  function keyContextBlocked(event) {
    return !!document.querySelector('dialog[open]')
      || !!event.target?.closest?.('textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="range"])');
  }

  function handleToolKeys(event) {
    if (event.defaultPrevented || keyContextBlocked(event)) return;
    for (const handler of state.keyHandlers) {
      if (handler(event)) { event.preventDefault(); return; }
    }
    if (!current || view !== 'edit') return;
    const key = String(event.key || '');
    const lower = key.toLowerCase();
    const modified = event.ctrlKey || event.metaKey;

    if (modified && !event.altKey) {
      if (lower === 'd' && !event.shiftKey) { event.preventDefault(); deselectActiveMask(); return; }
      if (lower === 'd' && event.shiftKey) { event.preventDefault(); reselectLastMask(); return; }
      if (lower === 'i' && event.shiftKey) { event.preventDefault(); invertActiveMask(); return; }
      if (lower === 'a' && !event.shiftKey) { event.preventDefault(); selectAllRegion(); return; }
      return;
    }
    if (modified || event.altKey) return;

    if (key === '?' && !modified) { event.preventDefault(); openHelpCenter(); return; }
    if (key === 'Enter' && state.pending) { event.preventDefault(); closePending(); return; }
    if (key === 'Escape' && (state.pending || state.gesture)) { event.preventDefault(); cancelPending(); state.gesture = null; return; }
    if ((key === 'Backspace' || key === 'Delete') && state.pending) { event.preventDefault(); removeLastPendingPoint(); return; }

    const toolKeys = { v: 'move', m: 'marquee', l: 'lasso', w: 'wand', c: 'crop', z: 'zoom', h: 'hand', i: 'eyedropper', j: 'heal' };
    if (lower === 'p' && !event.shiftKey) { event.preventDefault(); activateTool('pen'); return; }
    if (lower === 'g') { event.preventDefault(); activateGradientTool(event.shiftKey); return; }
    if (toolKeys[lower]) {
      if (event.shiftKey && !['m', 'l'].includes(lower)) return;
      event.preventDefault();
      activateTool(toolKeys[lower], { cycleVariant: event.shiftKey });
      return;
    }
  }

  function deselectActiveMask() {
    if (!current) return;
    cancelPending();
    if (current.edits.masks.activeId) {
      state.lastDeselectedId = current.edits.masks.activeId;
      current.edits.masks.activeId = '';
      refreshControls();
      scheduleRender();
      debounceSave();
    }
    setTool('');
    toast('Deselected · Ctrl+Shift+D reselects');
  }

  function reselectLastMask() {
    if (!current) return;
    const layer = state.lastDeselectedId ? maskById(state.lastDeselectedId) : null;
    if (!layer) { toast('Nothing to reselect'); return; }
    current.edits.masks.activeId = layer.id;
    refreshControls();
    scheduleRender();
    debounceSave();
    toast('Reselected ' + layer.name);
  }

  function invertActiveMask() {
    const mask = activeMask();
    if (!mask) { toast('Create or choose a mask to invert'); return; }
    commit('Invert mask', () => { activeMask().invert = !activeMask().invert; });
    toast(activeMask()?.invert ? 'Mask inverted' : 'Mask invert removed');
  }

  function selectAllRegion() {
    if (!current) return;
    const prepared = preparedNow();
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => {
      const source = E.outputPointToSourcePrepared(sourceImage, prepared, x, y);
      return [source.x, source.y];
    });
    commitRegion({ kind: 'polygon', points: corners }, 'new', 'Select all');
  }

  // ---------------------------------------------------------------------------
  // Crop tool routing (implemented in crop-tool.js, registered here)
  // ---------------------------------------------------------------------------

  let cropRouter = null;
  function routeCrop(type, event) {
    if (!cropRouter) return false;
    try { return !!cropRouter(type, event); }
    catch (error) { console.warn('[Luma] Crop tool handler failed', error); return false; }
  }

  // ---------------------------------------------------------------------------
  // Integration: wrap setTool, bind listeners, expose API
  // ---------------------------------------------------------------------------

  const TOOL_INSTRUCTIONS = {
    'tool-move': 'Drag the photo to reposition it · corners zoom · edges stretch · double-check with Reset in the bar above',
    'tool-marquee': 'Drag to select · Shift adds · Alt subtracts · Shift+Alt intersects',
    'tool-lasso': 'Draw around an area to select it · Shift adds · Alt subtracts',
    'tool-wand': 'Click a color to auto-select similar pixels',
    'tool-pen': 'Click to place points, drag for curves · Enter closes the path',
    'tool-zoom': 'Click zooms in · Alt+click zooms out · double-click fits',
    'tool-hand': 'Drag to pan the photo'
  };

  const baseSetTool = setTool;
  setTool = function wrappedSetTool(mode, options = {}) {
    const leavingCrop = toolMode === 'tool-crop' && mode !== 'tool-crop';
    if (leavingCrop) routeCrop('exit', null);
    if (!RAIL_TOOL_MODES.includes(mode)) { cancelPending(); }
    baseSetTool(mode, options);
    if (toolMode === 'tool-crop') routeCrop('enter', null);
    if (!options.quiet && TOOL_INSTRUCTIONS[toolMode] && !state.instructedTools.has(toolMode)) {
      state.instructedTools.add(toolMode);
      toast(TOOL_INSTRUCTIONS[toolMode]);
    }
    syncRail();
    renderOptions();
  };

  function bindListeners() {
    const wrap = $wrap();
    if (!wrap) return;
    wrap.addEventListener('pointerdown', onPointerDown, { capture: true });
    wrap.addEventListener('pointermove', onPointerMove, { capture: true });
    wrap.addEventListener('pointerup', onPointerUp, { capture: true });
    wrap.addEventListener('pointercancel', onPointerCancel, { capture: true });
    wrap.addEventListener('dblclick', onDoubleClick, { capture: true });
    wrap.addEventListener('click', event => {
      if (consumesPointer() && event.target === $canvas()) consume(event);
    }, { capture: true });
    window.addEventListener('keydown', handleToolKeys, { capture: true });
    new ResizeObserver(() => positionOverlay()).observe($canvas());
  }

  /** Public surface for app.js, crop-tool.js, and the e2e tests. */
  globalThis.LumaToolRail = {
    state,
    TOOLS,
    activateTool,
    commitRegion,
    addSelectionLayer,
    activeGeometryMask,
    screenFromSourceMatrix,
    orientedDims,
    canvasDisplayRect,
    pointerFraction,
    requestDraft,
    cancelPendingDraft,
    beginCanvasWarp,
    drawCanvasWarp,
    endCanvasWarp,
    refresh() { syncRail(); renderOptions(); },
    editActiveSelection() {
      state.combine = 'add';
      switchRightPanel('mask');
      setTool('tool-lasso', { force: true });
    },
    registerOverlayPainter(painter) { state.overlayPainters.push(painter); },
    registerKeyHandler(handler) { state.keyHandlers.push(handler); },
    registerCropRouter(router) { cropRouter = router; },
    registerOptionsProvider(toolId, provider) { optionsProviders.set(toolId, provider); }
  };

  buildRail();
  renderOptions();
  bindListeners();
  requestAnimationFrame(overlayLoop);
})();
