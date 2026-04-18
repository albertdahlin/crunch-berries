// @ts-check
/** @typedef {import('./types.js').MapRuntime} MapRuntime */

import { DX, DY, GROUND_TYPES, GROUND_SWAMP } from './constants.js';

// Costs from BFS expand direction (monster moves opposite):
//   expand up (0) => monster goes down => cheap (2)
//   expand diag-up (1,7) => monster goes diag-down => cheap (3)
//   expand side (2,6) => sideways => moderate (4)
//   expand diag-down (3,5) => monster goes diag-up => expensive (6)
//   expand down (4) => monster goes up => most expensive (7)
const DIR_COST = [2, 3, 4, 6, 7, 6, 4, 3];

/**
 * @param {MapRuntime} runtime
 * @param {?Uint8Array} [tempGrid] Optional alternative occupancy grid for tentative placements.
 * @returns {{dist: Int32Array, flow: Int8Array}}
 */
export function computePath(runtime, tempGrid) {
  const { cols, rows, ground } = runtime;
  const g = tempGrid || runtime.grid;
  const dist = new Int32Array(cols * rows).fill(-1);
  const flow = new Int8Array(cols * rows).fill(-1);

  const heap = [];
  function heapPush(cost, idx) {
    heap.push((cost << 16) | idx);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent] <= heap[i]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }
  function heapPop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && heap[l] < heap[smallest]) smallest = l;
        if (r < heap.length && heap[r] < heap[smallest]) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  for (let x = 0; x < cols; x++) {
    const idx = (rows - 1) * cols + x;
    if (g[idx] === 0 && GROUND_TYPES[ground[idx]].walkable) {
      dist[idx] = 0;
      heapPush(0, idx);
    }
  }

  while (heap.length > 0) {
    const val = heapPop();
    const d = val >> 16;
    const idx = val & 0xFFFF;
    if (d > dist[idx] && dist[idx] !== -1 && d !== 0) continue;
    const cx = idx % cols;
    const cy = (idx - cx) / cols;

    for (let dir = 0; dir < 8; dir++) {
      const nx = cx + DX[dir];
      const ny = cy + DY[dir];
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (g[ni] !== 0 || !GROUND_TYPES[ground[ni]].walkable) continue;
      if (dir % 2 === 1) {
        const adj1Idx = cy * cols + nx;
        const adj2Idx = ny * cols + cx;
        if (g[adj1Idx] !== 0 || !GROUND_TYPES[ground[adj1Idx]].walkable ||
            g[adj2Idx] !== 0 || !GROUND_TYPES[ground[adj2Idx]].walkable) continue;
      }
      let tileCost = DIR_COST[dir];
      if (ground[ni] === GROUND_SWAMP) tileCost *= 2;
      const nd = d + tileCost;
      if (dist[ni] !== -1 && nd >= dist[ni]) continue;
      dist[ni] = nd;
      flow[ni] = (dir + 4) % 8;
      heapPush(nd, ni);
    }
  }

  return { dist, flow };
}

/** @param {MapRuntime} runtime */
export function recomputePath(runtime) {
  const { dist, flow } = computePath(runtime);
  runtime.pathDist = dist;
  runtime.pathFlow = flow;
}

/** @param {MapRuntime} runtime @param {?Uint8Array} [tempGrid] */
export function isTopRowReachable(runtime, tempGrid) {
  const { dist } = computePath(runtime, tempGrid);
  for (let x = 0; x < runtime.cols; x++) {
    if (dist[x] !== -1) return true;
  }
  return false;
}
