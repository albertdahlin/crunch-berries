// @ts-check
// Pan/zoom controller for an orthographic isometric camera. Kept renderer-
// agnostic so a future WebGPU renderer can reuse it. The controller owns the
// ground-plane target point and a zoom scalar; the renderer reads these and
// positions its camera each frame.

/**
 * @param {{
 *   domElement: HTMLElement,
 *   onChange: () => void,
 *   clickThreshold?: number,
 * }} opts
 */
export function createCameraControl(opts) {
  const { domElement, onChange } = opts;
  const clickThreshold = opts.clickThreshold ?? 8;

  // Target on ground plane (world XZ). Initialized to (0, 0) — callers should
  // call setMapBounds() + centerOnMap() when a map is loaded.
  const target = { x: 0, z: 0 };
  let zoom = 1;
  let enabled = true;
  let bounds = { cols: 15, rows: 15 };
  // Pixels-per-world-unit at zoom=1 (set by the renderer on resize).
  let pixelsPerUnit = 40;

  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 4.0;

  let dragging = false;
  let dragMoved = false;
  let pointerStart = { x: 0, y: 0 };
  /** @type {Map<number, {x: number, y: number}>} */
  const activeTouches = new Map();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  function clampTarget() {
    const margin = 2;
    target.x = Math.max(-margin, Math.min(bounds.cols + margin, target.x));
    target.z = Math.max(-margin, Math.min(bounds.rows + margin, target.z));
  }

  function setMapBounds(cols, rows) {
    bounds = { cols, rows };
    clampTarget();
    onChange();
  }

  function centerOnMap() {
    target.x = bounds.cols / 2;
    target.z = bounds.rows / 2;
    zoom = 1;
    onChange();
  }

  function setPixelsPerUnit(ppu) {
    pixelsPerUnit = ppu;
  }

  function panByPixels(dx, dy) {
    // Drag delta is in screen pixels. Screen X corresponds to world (X-Z)/√2,
    // screen Y corresponds to (X+Z)/√2 * sin(elev). We just invert the
    // isometric projection empirically: dx_world ≈ dx_px / (ppu * zoom),
    // dy_world ≈ dy_px / (ppu * zoom * sin(elev)).
    // For true iso elev = asin(1/√3), sin(elev) = 1/√3.
    // Simpler heuristic: treat screen space as rotated 45° on the ground plane.
    const SIN_ELEV = 1 / Math.sqrt(3);
    const s = 1 / (pixelsPerUnit * zoom);
    const wx = dx * s;
    const wy = dy * s / SIN_ELEV;
    // Rotate (wx, wy) by -45° around ground plane to get world (X, Z).
    const cos = Math.cos(-Math.PI / 4);
    const sin = Math.sin(-Math.PI / 4);
    const worldDX =  cos * wx - sin * wy;
    const worldDZ =  sin * wx + cos * wy;
    // Drag in the opposite direction of the pan so the world follows the finger.
    target.x -= worldDX;
    target.z -= worldDZ;
    clampTarget();
    onChange();
  }

  function zoomBy(factor, clientX, clientY) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    onChange();
  }

  // --- Mouse ---
  const onMouseDown = (e) => {
    if (!enabled) return;
    if (e.button !== 0) return;
    dragging = true;
    dragMoved = false;
    pointerStart = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    if (Math.abs(dx) > clickThreshold || Math.abs(dy) > clickThreshold) {
      dragMoved = true;
    }
    if (dragMoved) {
      panByPixels(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
      pointerStart = { x: e.clientX, y: e.clientY };
    }
  };
  const onMouseUp = () => {
    dragging = false;
  };
  const onWheel = (e) => {
    if (!enabled) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomBy(factor, e.clientX, e.clientY);
  };

  // --- Touch ---
  const onTouchStart = (e) => {
    if (!enabled) return;
    for (const t of e.changedTouches) {
      activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (activeTouches.size === 1) {
      dragging = true;
      dragMoved = false;
      const t = e.touches[0];
      pointerStart = { x: t.clientX, y: t.clientY };
    } else if (activeTouches.size === 2) {
      dragging = false;
      const [a, b] = [...activeTouches.values()];
      pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartZoom = zoom;
    }
  };
  const onTouchMove = (e) => {
    if (!enabled) return;
    for (const t of e.changedTouches) {
      if (activeTouches.has(t.identifier)) {
        activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
    if (activeTouches.size === 1 && dragging) {
      const t = e.touches[0];
      const dx = t.clientX - pointerStart.x;
      const dy = t.clientY - pointerStart.y;
      if (Math.abs(dx) > clickThreshold || Math.abs(dy) > clickThreshold) {
        dragMoved = true;
      }
      if (dragMoved) {
        panByPixels(dx, dy);
        pointerStart = { x: t.clientX, y: t.clientY };
      }
    } else if (activeTouches.size === 2) {
      const [a, b] = [...activeTouches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDist > 0) {
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoom * (dist / pinchStartDist)));
        onChange();
      }
    }
  };
  const onTouchEnd = (e) => {
    for (const t of e.changedTouches) activeTouches.delete(t.identifier);
    if (activeTouches.size < 2) pinchStartDist = 0;
    if (activeTouches.size === 0) dragging = false;
  };

  domElement.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('touchstart', onTouchStart, { passive: true });
  domElement.addEventListener('touchmove',  onTouchMove,  { passive: true });
  domElement.addEventListener('touchend',   onTouchEnd);

  function destroy() {
    domElement.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    domElement.removeEventListener('wheel', onWheel);
    domElement.removeEventListener('touchstart', onTouchStart);
    domElement.removeEventListener('touchmove',  onTouchMove);
    domElement.removeEventListener('touchend',   onTouchEnd);
  }

  return {
    target, get zoom() { return zoom; }, set zoom(v) { zoom = v; onChange(); },
    /** Call to distinguish a click-with-no-drag from a drag. */
    isDrag: () => dragMoved,
    setMapBounds,
    centerOnMap,
    setPixelsPerUnit,
    setEnabled: (v) => { enabled = v; if (!v) { dragging = false; activeTouches.clear(); } },
    destroy,
  };
}
