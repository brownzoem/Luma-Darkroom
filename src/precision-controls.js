(() => {
  'use strict';

  const states = new WeakMap();
  const SCRUB_THRESHOLD_PX = 3;
  const SCRUB_PX_PER_STEP = 6;
  const SCRUB_FINE_PX_PER_STEP = 24;
  const SCRUB_COARSE_PX_PER_STEP = 2;
  const EDIT_STEP = 0.01;
  const MODEL_PLACES = 6;
  const DISPLAY_PLACES = 4;
  const HELP = 'Type a value · middle-drag horizontally · Shift for extra precision · Ctrl for faster movement';
  let generatedId = 0;
  let activeScrub = null;
  let activeNumberState = null;
  let scrubFrame = 0;

  function numberAttribute(input, name, fallback) {
    const value = Number(input.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function decimalPlaces(value) {
    const text = String(value).toLowerCase();
    if (text.includes('e-')) return Math.min(12, Number(text.split('e-')[1]) || 0);
    return Math.min(12, (text.split('.')[1] || '').length);
  }

  function metrics(range) {
    const min = numberAttribute(range, 'min', 0);
    const max = numberAttribute(range, 'max', 100);
    const rawStep = range.getAttribute('step');
    const parsedStep = Number(rawStep);
    const step = rawStep === 'any' || !Number.isFinite(parsedStep) || parsedStep <= 0 ? 1 : parsedStep;
    return { min, max: Math.max(min, max), step, places: Math.max(decimalPlaces(min), decimalPlaces(step)) };
  }

  function precisionStep(range) {
    const { step } = metrics(range);
    return range.dataset.path ? Math.min(step, EDIT_STEP) : step;
  }

  function editValue(range) {
    if (range.dataset.path && typeof current !== 'undefined' && current && typeof getPath === 'function') {
      const value = Number(getPath(current.edits, range.dataset.path));
      if (Number.isFinite(value)) return value;
    }
    return Number(range.value);
  }

  function normalize(range, value) {
    if (!Number.isFinite(value)) return null;
    const { min, max, step, places } = metrics(range);
    const clamped = Math.max(min, Math.min(max, value));
    if (range.dataset.path) return Number(clamped.toFixed(MODEL_PLACES));
    const stepped = min + Math.round((clamped - min) / step) * step;
    return Number(Math.max(min, Math.min(max, stepped)).toFixed(places));
  }

  function format(range, value = Number(range.value)) {
    const normalized = normalize(range, value);
    if (normalized == null) return '';
    if (!range.dataset.path) return normalized.toFixed(metrics(range).places);
    const places = Math.max(2, decimalPlaces(precisionStep(range)), Math.min(DISPLAY_PLACES, decimalPlaces(normalized)));
    return normalized.toFixed(places);
  }

  function labelText(range) {
    const explicit = range.getAttribute('aria-label');
    if (explicit) return explicit.replace(/\s+slider$/i, '');
    const parent = range.parentElement;
    const label = parent ? [...parent.children].find(element => element.tagName === 'LABEL' && element.htmlFor === range.id) : null;
    if (label) return [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ').trim() || 'Adjustment';
    return range.id ? range.id.replace(/^control-/, '').replace(/[-_]+/g, ' ') : 'Adjustment';
  }

  function ensureId(range) {
    if (range.id) return;
    let candidate;
    do { candidate = `precision-range-${++generatedId}`; } while (document.getElementById(candidate));
    range.id = candidate;
  }

  function placeCompanion(range, number) {
    const parent = range.parentElement;
    const directLabel = parent ? [...parent.children].find(element => element.tagName === 'LABEL' && element.htmlFor === range.id) : null;
    if (directLabel) {
      const heading = document.createElement('div');
      heading.className = 'range-precision-heading';
      directLabel.before(heading);
      heading.append(directLabel, number);
      directLabel.querySelectorAll('output').forEach(output => output.classList.add('range-passive-output'));
      parent.classList.add('has-precision-input');
      return;
    }
    const inline = document.createElement('span');
    inline.className = 'range-precision-inline';
    range.before(inline);
    inline.append(range, number);
  }

  function captureAnchor(range) {
    if (!range.dataset.path || typeof current === 'undefined') return null;
    return {
      photoId: current?.id || null,
      maskId: range.dataset.path.startsWith('mask.') && typeof activeMask === 'function' ? activeMask()?.id || null : null
    };
  }

  function anchorMatches(state) {
    const anchor = state.anchor;
    if (!anchor || typeof current === 'undefined') return true;
    if ((current?.id || null) !== anchor.photoId) return false;
    if (anchor.maskId && typeof activeMask === 'function' && activeMask()?.id !== anchor.maskId) return false;
    return true;
  }

  function emit(range, type, value) {
    const init = { bubbles: true };
    const event = Number.isFinite(value)
      ? new CustomEvent(type, { ...init, detail: { precisionValue: value } })
      : new Event(type, init);
    range.dispatchEvent(event);
  }

  function sync(range, { force = false, value } = {}) {
    if (!(range instanceof HTMLInputElement) || range.type !== 'range') return null;
    const state = states.get(range) || enhance(range);
    if (!state) return null;
    const { number } = state;
    const supplied = Number(value);
    const next = normalize(range, Number.isFinite(supplied) ? supplied : Number(range.value));
    if (next != null) state.preciseValue = next;
    const numberStep = range.dataset.path ? String(precisionStep(range)) : range.step || '1';
    if (number.min !== range.min) number.min = range.min;
    if (number.max !== range.max) number.max = range.max;
    if (number.step !== numberStep) number.step = numberStep;
    if (number.disabled !== range.disabled) number.disabled = range.disabled;
    if (!force && state.editing && document.activeElement === number) return;
    number.value = format(range, state.preciseValue);
    number.removeAttribute('aria-invalid');
    return state;
  }

  function applyValue(state, rawValue, { preserveText = false } = {}) {
    if (!anchorMatches(state)) {
      sync(state.range, { force: true });
      return false;
    }
    const next = normalize(state.range, Number(rawValue));
    if (next == null) return false;
    const previous = state.preciseValue;
    if (previous !== next) {
      state.preciseValue = next;
      state.range.value = String(next);
      state.touched = true;
      emit(state.range, 'input', next);
    }
    if (!preserveText) sync(state.range, { force: true, value: state.preciseValue });
    return true;
  }

  function beginNumberSession(state) {
    if (activeNumberState && activeNumberState !== state) finalizeNumber(activeNumberState);
    state.editing = true;
    state.touched = false;
    state.startValue = state.preciseValue;
    state.anchor = captureAnchor(state.range);
    state.number.removeAttribute('aria-invalid');
    activeNumberState = state;
  }

  function validNumber(number) {
    return number.value.trim() !== '' && Number.isFinite(number.valueAsNumber);
  }

  function finalizeNumber(state, { keepFocus = false } = {}) {
    if (!state.editing) {
      sync(state.range, { force: true });
      return;
    }
    if (!validNumber(state.number)) {
      cancelNumber(state);
      return;
    }
    const touched = state.touched;
    state.editing = keepFocus;
    state.touched = false;
    state.anchor = keepFocus ? captureAnchor(state.range) : null;
    state.startValue = state.preciseValue;
    sync(state.range, { force: true, value: state.preciseValue });
    if (activeNumberState === state) activeNumberState = keepFocus ? state : null;
    if (touched) emit(state.range, 'change');
  }

  function cancelNumber(state) {
    if (!state.editing) return;
    const touched = state.touched;
    if (touched && anchorMatches(state)) {
      const start = normalize(state.range, Number(state.startValue));
      if (start != null && state.preciseValue !== start) {
        state.preciseValue = start;
        state.range.value = String(start);
        emit(state.range, 'input', start);
      }
      emit(state.range, 'change');
    }
    state.touched = false;
    state.editing = false;
    state.anchor = null;
    state.startValue = state.preciseValue;
    sync(state.range, { force: true, value: state.preciseValue });
    if (activeNumberState === state) activeNumberState = null;
  }

  function flushScrub(active = activeScrub) {
    if (!active || active !== activeScrub || active.pendingValue == null) return;
    const value = active.pendingValue;
    active.pendingValue = null;
    if (!anchorMatches(active.state)) return;
    const next = normalize(active.state.range, Number(value));
    if (next == null || next === active.state.preciseValue) return;
    if (!active.transactionStarted && active.state.range.dataset.path) {
      active.state.range.onpointerdown?.({ button: 0, precision: true });
      active.transactionStarted = true;
    }
    if (applyValue(active.state, next)) active.changed = active.state.touched;
  }

  function queueScrubValue(value) {
    if (!activeScrub) return;
    activeScrub.pendingValue = value;
    if (scrubFrame) return;
    scrubFrame = requestAnimationFrame(() => {
      scrubFrame = 0;
      flushScrub();
    });
  }

  function finishScrub({ restore = false } = {}) {
    const active = activeScrub;
    if (!active) return;
    if (scrubFrame) {
      cancelAnimationFrame(scrubFrame);
      scrubFrame = 0;
    }
    flushScrub(active);
    activeScrub = null;
    if (restore && active.changed && anchorMatches(active.state)) {
      active.state.preciseValue = active.startValue;
      active.state.range.value = String(active.startValue);
      emit(active.state.range, 'input', active.startValue);
    }
    document.body.classList.remove('precision-scrubbing');
    active.state.range.classList.remove('precision-scrubbing-target');
    active.state.number.classList.remove('precision-scrubbing-target');
    try { active.captureTarget.releasePointerCapture?.(active.pointerId); } catch {}
    if (active.changed || active.transactionStarted) emit(active.state.range, 'change');
    active.state.touched = false;
    active.state.anchor = null;
    sync(active.state.range, { force: true, value: active.state.preciseValue });
  }

  function beginScrub(event, state) {
    if (event.button !== 1 || state.range.disabled || state.number.disabled || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    if (activeScrub) finishScrub();
    if (state.editing) finalizeNumber(state);
    state.touched = false;
    state.anchor = captureAnchor(state.range);
    activeScrub = {
      state,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startX: event.clientX,
      lastX: event.clientX,
      startValue: state.preciseValue,
      pendingValue: null,
      changed: false,
      moved: false,
      transactionStarted: false,
      modifierMode: null,
      pixelRemainder: 0
    };
    document.body.classList.add('precision-scrubbing');
    state.range.classList.add('precision-scrubbing-target');
    state.number.classList.add('precision-scrubbing-target');
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  }

  function moveScrub(event) {
    const active = activeScrub;
    if (!active || event.pointerId !== active.pointerId) return;
    if (event.buttons && !(event.buttons & 4)) {
      finishScrub();
      return;
    }
    event.preventDefault();
    const distance = event.clientX - active.startX;
    if (!active.moved && Math.abs(distance) < SCRUB_THRESHOLD_PX) return;
    active.moved = true;
    const mode = event.ctrlKey || event.metaKey ? 'coarse' : event.shiftKey ? 'fine' : 'normal';
    if (active.modifierMode && active.modifierMode !== mode) {
      active.modifierMode = mode;
      active.lastX = event.clientX;
      active.pixelRemainder = 0;
      return;
    }
    active.modifierMode = mode;
    active.pixelRemainder += event.clientX - active.lastX;
    active.lastX = event.clientX;
    const pixelsPerStep = mode === 'fine' ? SCRUB_FINE_PX_PER_STEP : mode === 'coarse' ? SCRUB_COARSE_PX_PER_STEP : SCRUB_PX_PER_STEP;
    const rounded = active.pixelRemainder >= 0
      ? Math.floor((active.pixelRemainder + pixelsPerStep / 2) / pixelsPerStep)
      : Math.ceil((active.pixelRemainder - pixelsPerStep / 2) / pixelsPerStep);
    if (!rounded) return;
    active.pixelRemainder -= rounded * pixelsPerStep;
    const { min, max, step } = metrics(active.state.range);
    const unit = mode === 'coarse' ? step : precisionStep(active.state.range);
    const base = active.pendingValue ?? active.state.preciseValue;
    const raw = base + rounded * unit;
    const next = normalize(active.state.range, raw);
    if (next === base && (raw < min || raw > max)) active.pixelRemainder = 0;
    queueScrubValue(next);
  }

  function finishPointer(event) {
    if (!activeScrub || event.pointerId !== activeScrub.pointerId) return;
    event.preventDefault();
    finishScrub();
  }

  function bindNumber(state) {
    const { number, range } = state;
    number.addEventListener('focus', () => {
      beginNumberSession(state);
      number.select();
    });
    number.addEventListener('input', () => {
      if (!state.editing) beginNumberSession(state);
      if (!validNumber(number)) {
        number.setAttribute('aria-invalid', 'true');
        return;
      }
      number.removeAttribute('aria-invalid');
      applyValue(state, number.valueAsNumber, { preserveText: true });
    });
    number.addEventListener('change', () => finalizeNumber(state));
    number.addEventListener('blur', () => finalizeNumber(state));
    number.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finalizeNumber(state, { keepFocus: true });
        number.select();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelNumber(state);
        number.blur();
      } else if (event.key === 'PageUp' || event.key === 'PageDown' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        if (!state.editing) beginNumberSession(state);
        const { min, max } = metrics(range);
        const step = precisionStep(range);
        const next = event.key === 'Home' ? min : event.key === 'End' ? max : state.preciseValue + (event.key === 'PageUp' ? 10 : -10) * step;
        applyValue(state, next);
        number.select();
      }
    });
    number.addEventListener('dblclick', event => {
      event.stopPropagation();
      number.select();
    });
    number.addEventListener('pointerdown', event => beginScrub(event, state));
    number.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
    number.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  }

  function enhance(range) {
    if (!(range instanceof HTMLInputElement) || range.type !== 'range') return null;
    if (states.has(range)) return states.get(range);
    ensureId(range);
    const name = labelText(range);
    const number = document.createElement('input');
    number.type = 'number';
    number.className = 'range-number';
    number.id = `${range.id}-value`;
    number.dataset.numberFor = range.id;
    number.inputMode = 'decimal';
    number.autocomplete = 'off';
    number.spellcheck = false;
    number.setAttribute('aria-label', `${name} value`);
    number.title = HELP;
    range.title = HELP;
    const initialValue = normalize(range, editValue(range));
    const state = { range, number, editing: false, touched: false, preciseValue: initialValue, startValue: initialValue, anchor: null };
    states.set(range, state);
    range.dataset.precisionEnhanced = 'true';
    placeCompanion(range, number);
    bindNumber(state);
    range.addEventListener('input', event => {
      const detailed = Number(event.detail?.precisionValue);
      sync(range, { value: Number.isFinite(detailed) ? detailed : Number(range.value) });
    });
    range.addEventListener('change', () => sync(range, { force: true, value: state.preciseValue }));
    range.addEventListener('pointerdown', event => beginScrub(event, state));
    range.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
    range.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
    range.addEventListener('lostpointercapture', event => finishPointer(event), { capture: true });
    number.addEventListener('lostpointercapture', event => finishPointer(event), { capture: true });
    sync(range, { force: true, value: state.preciseValue });
    return state;
  }

  function scan(root = document) {
    if (root !== document && !root.isConnected) return;
    if (root.matches?.('input[type="range"]')) enhance(root);
    root.querySelectorAll?.('input[type="range"]').forEach(enhance);
  }

  function syncAll({ force = false } = {}) {
    document.querySelectorAll('input[type="range"]').forEach(range => {
      enhance(range);
      sync(range, { force, value: editValue(range) });
    });
  }

  window.addEventListener('pointermove', moveScrub, { capture: true, passive: false });
  window.addEventListener('pointerup', finishPointer, { capture: true, passive: false });
  window.addEventListener('pointercancel', finishPointer, { capture: true, passive: false });
  window.addEventListener('blur', () => {
    finishScrub();
    if (activeNumberState) finalizeNumber(activeNumberState);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeScrub) {
      event.preventDefault();
      event.stopPropagation();
      finishScrub({ restore: true });
    }
  }, { capture: true });

  const observer = new MutationObserver(records => {
    if (activeScrub && !activeScrub.state.range.isConnected) finishScrub();
    if (activeNumberState && !activeNumberState.number.isConnected) finalizeNumber(activeNumberState);
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches?.('input[type="range"]')) {
          const state = enhance(record.target);
          sync(record.target, { force: true, value: state?.preciseValue });
        }
      } else {
        record.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE) scan(node); });
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['min', 'max', 'step', 'disabled'] });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && activeNumberState) finalizeNumber(activeNumberState);
  });
  scan();

  window.LumaPrecisionControls = { enhance, scan, sync, syncAll, finishActive: finishScrub, isScrubbing: () => !!activeScrub };
})();
