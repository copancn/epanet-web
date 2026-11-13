'use strict';

/* ============================ state ============================ */
const DEFAULT_OPTIONS = { flowUnits: 'LPS', headLoss: 'H-W', demandMult: 1, trials: 40, accuracy: 0.001, tolerance: 0.01, unbalanced: 10 };
const DEFAULT_TIMES = { duration: 86400, hydStep: 3600, qualStep: 300, patternStep: 3600, patternStart: 0, reportStep: 3600, reportStart: 0, startClock: 0, statistic: 'NONE' };

function emptyNetwork() {
  return {
    title: t('net.newTitle'), nodes: [], links: [], patterns: [], curves: [], controls: [],
    options: { ...DEFAULT_OPTIONS }, times: { ...DEFAULT_TIMES },
    quality: { type: 'NONE', chemName: 'Chlorine', chemUnits: 'mg/L', traceNode: '' },
    geo: defaultGeo(),
  };
}

const state = {
  net: emptyNetwork(),
  tool: 'select',
  sel: null,            // {kind:'node'|'link', id}
  draft: null,          // {from, wx, wy}
  view: { scale: 1, panX: 0, panY: 0 },
  results: null,
  resNode: {}, resLink: {},
  timeIndex: 0,
  nodeColor: 'pressure',
  linkColor: 'flow',
  playing: false,
  stale: false,
  engineStatus: 'checking', engineVersion: 0,
  elemTab: 'nodes',
  mouse: { sx: 0, sy: 0, wx: 0, wy: 0 },
  drag: null,
  hover: null,
};

const TYPE_COLOR = { JUNCTION: '#334155', RESERVOIR: '#0ea5e9', TANK: '#8b5cf6', PIPE: '#64748b', PUMP: '#db2777' };
const VALVE_TYPES = ['PRV', 'PSV', 'PBV', 'FCV', 'TCV', 'GPV'];
function linkColorBase(t) { return t === 'PUMP' ? '#db2777' : (VALVE_TYPES.includes(t) ? '#ea580c' : '#64748b'); }

/* ============================ dom ============================ */
const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

/* ============================ api ============================ */
async function api(path, method, body, reqText, respText) {
  const opt = { method: method || 'GET' };
  if (body !== undefined) {
    opt.body = reqText ? body : JSON.stringify(body);
    opt.headers = { 'Content-Type': reqText ? 'text/plain' : 'application/json' };
  }
  const r = await fetch(path, opt);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return respText ? r.text() : r.json();
}

function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 5000 : 2600);
}

/* ============================ geometry ============================ */
function w2s(wx, wy) { return [wx * state.view.scale + state.view.panX, -wy * state.view.scale + state.view.panY]; }
function s2w(sx, sy) { return [(sx - state.view.panX) / state.view.scale, -(sy - state.view.panY) / state.view.scale]; }

function nodeById(id) { return state.net.nodes.find(n => n.id === id); }
function linkById(id) { return state.net.links.find(l => l.id === id); }
function selObj() {
  if (!state.sel) return null;
  return state.sel.kind === 'node' ? nodeById(state.sel.id) : linkById(state.sel.id);
}

function networkBounds() {
  const pts = [];
  state.net.nodes.forEach(n => pts.push([n.x, n.y]));
  state.net.links.forEach(l => (l.vertices || []).forEach(v => pts.push([v.x, v.y])));
  if (!pts.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
  return { minX, maxX, minY, maxY };
}

function fitView() {
  const b = networkBounds();
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!b) { state.view = { scale: 1, panX: W / 2, panY: H / 2 }; render(); return; }
  const pad = 80;
  const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  const scale = Math.max(0.05, Math.min((W - pad * 2) / bw, (H - pad * 2) / bh, 4));
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  state.view.scale = scale;
  state.view.panX = W / 2 - cx * scale;
  state.view.panY = H / 2 + cy * scale;
  render();
}

/* ============================ rendering ============================ */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function render() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  ctx.clearRect(0, 0, W, H);
  if (state.net.geo && state.net.geo.enabled) drawMap(W, H); else drawGrid(W, H);
  state.net.links.forEach(l => drawLink(l));
  if (state.draft) drawDraft();
  state.net.nodes.forEach(n => drawNode(n));
}

function drawGrid(W, H) {
  const scale = state.view.scale;
  if (!(scale > 0) || !isFinite(scale) || !(W > 0) || !(H > 0)) return;
  let step = 50;
  while (step * scale < 32 && step < 1e7) step *= 2;
  while (step * scale > 90 && step > 1e-6) step /= 2;
  const [wx0, wy0] = s2w(0, H);
  const [wx1, wy1] = s2w(W, 0);
  ctx.strokeStyle = '#eef2f7'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) {
    const [sx] = w2s(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
  }
  for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) {
    const [, sy] = w2s(0, y); ctx.moveTo(0, sy); ctx.lineTo(W, sy);
  }
  ctx.stroke();
}

/* ============================ map layer (OSM) ============================ */
const MERC_R = 6378137;                 // Web Mercator sphere radius (EPSG:3857)
const MERC_C = 2 * Math.PI * MERC_R;    // world circumference in meters
const TILE_SOURCES = [
  { id: 'osm', nameKey: 'map.layer.osm', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attr: '© OpenStreetMap contributors' },
  { id: 'esri', nameKey: 'map.layer.esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19, attr: 'Esri, Maxar, Earthstar Geographics' },
  { id: 'topo', nameKey: 'map.layer.topo', url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17, attr: '© OpenTopoMap (CC-BY-SA)' },
];
function defaultGeo() {
  return { enabled: false, opacity: 0.85, source: 'osm', lat: 39.9042, lon: 116.4074, ax: 0, ay: 0, scale: 1, rot: 0, anchorNode: '' };
}
function tileSource(id) { return TILE_SOURCES.find(s => s.id === id) || TILE_SOURCES[0]; }

// network coords <-> Web Mercator via similarity transform (anchor + scale + rotation)
function lonToMx(lon) { return MERC_R * lon * Math.PI / 180; }
function latToMy(lat) { return MERC_R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
function mxToLon(mx) { return mx / MERC_R * 180 / Math.PI; }
function myToLat(my) { return (2 * Math.atan(Math.exp(my / MERC_R)) - Math.PI / 2) * 180 / Math.PI; }
function netToMerc(x, y) {
  const g = state.net.geo;
  const th = g.rot * Math.PI / 180;
  const dx = (x - g.ax) * g.scale, dy = (y - g.ay) * g.scale;
  const E = dx * Math.cos(th) - dy * Math.sin(th);
  const N = dx * Math.sin(th) + dy * Math.cos(th);
  return [lonToMx(g.lon) + E, latToMy(g.lat) + N];
}
function mercToNet(mx, my) {
  const g = state.net.geo;
  const th = g.rot * Math.PI / 180;
  const E = mx - lonToMx(g.lon), N = my - latToMy(g.lat);
  const dx = E * Math.cos(th) + N * Math.sin(th);
  const dy = -E * Math.sin(th) + N * Math.cos(th);
  const s = g.scale || 1;
  return [g.ax + dx / s, g.ay + dy / s];
}
function mercToScreen(mx, my) { const [x, y] = mercToNet(mx, my); return w2s(x, y); }

// LRU tile cache
const tileCache = new Map();
const TILE_CACHE_MAX = 256;
function getTile(src, z, x, y) {
  const n = 1 << z;
  x = ((x % n) + n) % n;
  y = Math.max(0, Math.min(n - 1, y));
  const key = src.id + '/' + z + '/' + x + '/' + y;
  let entry = tileCache.get(key);
  if (entry) { tileCache.delete(key); tileCache.set(key, entry); return entry; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  entry = { img, ready: false, failed: false };
  img.onload = () => { entry.ready = true; render(); };
  img.onerror = () => { entry.failed = true; };
  img.src = src.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  tileCache.set(key, entry);
  if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
  return entry;
}

function drawMap(W, H) {
  const g = state.net.geo;
  const src = tileSource(g.source);
  if (!(state.view.scale > 0) || !isFinite(state.view.scale) || !(W > 0) || !(H > 0)) return;
  const ppm = state.view.scale / (g.scale || 1);   // screen pixels per Mercator meter
  let z = Math.round(Math.log2(ppm * MERC_C / 256));
  z = Math.max(0, Math.min(src.maxZoom, z));
  const n = 1 << z, Tm = MERC_C / n;               // meters per tile
  let minMx = Infinity, maxMx = -Infinity, minMy = Infinity, maxMy = -Infinity;
  [[0, 0], [W, 0], [0, H], [W, H]].forEach(([sx, sy]) => {
    const [wx, wy] = s2w(sx, sy);
    const [mx, my] = netToMerc(wx, wy);
    minMx = Math.min(minMx, mx); maxMx = Math.max(maxMx, mx);
    minMy = Math.min(minMy, my); maxMy = Math.max(maxMy, my);
  });
  if (!isFinite(minMx)) return;
  const tx0 = Math.max(0, Math.floor((minMx + MERC_C / 2) / Tm));
  const tx1 = Math.min(n - 1, Math.floor((maxMx + MERC_C / 2) / Tm));
  const ty0 = Math.max(0, Math.floor((MERC_C / 2 - maxMy) / Tm));
  const ty1 = Math.min(n - 1, Math.floor((MERC_C / 2 - minMy) / Tm));
  if (tx1 < tx0 || ty1 < ty0 || (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 4096) return;
  ctx.save();
  ctx.globalAlpha = g.opacity;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const entry = getTile(src, z, tx, ty);
      if (!entry.ready || entry.failed) continue;
      const mx0 = tx * Tm - MERC_C / 2, myTop = MERC_C / 2 - ty * Tm;
      const p0 = mercToScreen(mx0, myTop);          // image top-left (NW)
      const p1 = mercToScreen(mx0 + Tm, myTop);     // image top-right (NE)
      const p2 = mercToScreen(mx0, myTop - Tm);     // image bottom-left (SW)
      ctx.save();
      ctx.transform((p1[0] - p0[0]) / 256, (p1[1] - p0[1]) / 256, (p2[0] - p0[0]) / 256, (p2[1] - p0[1]) / 256, p0[0], p0[1]);
      ctx.drawImage(entry.img, 0, 0, 256, 256);
      ctx.restore();
    }
  }
  ctx.restore();
}

function linkPoints(l) {
  const a = nodeById(l.from), b = nodeById(l.to);
  if (!a || !b) return null;
  const pts = [[a.x, a.y]];
  (l.vertices || []).forEach(v => pts.push([v.x, v.y]));
  pts.push([b.x, b.y]);
  return pts.map(([x, y]) => w2s(x, y));
}

function drawLink(l) {
  const pts = linkPoints(l);
  if (!pts) return;
  const selected = state.sel && state.sel.kind === 'link' && state.sel.id === l.id;
  const rs = state.results ? state.resLink[l.id] : null;
  let color = linkColorBase(l.type);
  let width = 2.4;
  let closed = l.status === 'CLOSED';
  if (rs) {
    const t = state.timeIndex;
    if (state.linkColor === 'status') {
      color = rs.status[t] > 0.5 ? '#0f9d58' : '#b0b8c4';
    } else {
      const r = metricRange(state.results.links, state.linkColor);
      color = colorScale(norm(rs[state.linkColor][t], r));
    }
    closed = rs.status[t] < 0.5;
    width = 3;
  }
  if (selected) { ctx.strokeStyle = '#2563eb'; ctx.lineWidth = width + 5; ctx.lineCap = 'round'; strokePolyline(pts); }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.setLineDash(closed ? [6, 5] : []);
  strokePolyline(pts);
  ctx.setLineDash([]);

  // flow direction arrow
  if (rs && Math.abs(rs.flow[state.timeIndex]) > 1e-6 && state.linkColor !== 'status') {
    const rev = rs.flow[state.timeIndex] < 0;
    drawArrow(pts, rev, color);
  }
  // pump / valve symbol at midpoint
  const mid = polyMid(pts);
  if (l.type === 'PUMP') drawPumpSymbol(mid, color);
  else if (VALVE_TYPES.includes(l.type)) drawValveSymbol(mid, color);

  // label
  if (state.view.scale > 0.35) {
    ctx.fillStyle = selected ? '#2563eb' : '#64748b';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(l.id, mid[0], mid[1] - 8);
  }
}

function strokePolyline(pts) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}
function polyMid(pts) {
  // midpoint by total length
  let total = 0; const segs = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); total += d; }
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    if (half <= segs[i - 1]) { const f = segs[i - 1] ? half / segs[i - 1] : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])]; }
    half -= segs[i - 1];
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0])];
}
function drawArrow(pts, rev, color) {
  const m = polyMid(pts); let ang = m[2]; if (rev) ang += Math.PI;
  const s = 7;
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(m[0] + Math.cos(ang) * s, m[1] + Math.sin(ang) * s);
  ctx.lineTo(m[0] + Math.cos(ang + 2.5) * s, m[1] + Math.sin(ang + 2.5) * s);
  ctx.lineTo(m[0] + Math.cos(ang - 2.5) * s, m[1] + Math.sin(ang - 2.5) * s);
  ctx.closePath(); ctx.fill();
}
function drawPumpSymbol(m, color) {
  ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(m[0], m[1], 7, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(m[0] - 3, m[1] - 4); ctx.lineTo(m[0] + 5, m[1]); ctx.lineTo(m[0] - 3, m[1] + 4); ctx.closePath(); ctx.fill();
}
function drawValveSymbol(m, color) {
  ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m[0] - 6, m[1] - 5); ctx.lineTo(m[0] - 6, m[1] + 5); ctx.lineTo(m[0] + 6, m[1] - 5); ctx.lineTo(m[0] + 6, m[1] + 5); ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function drawNode(n) {
  const [sx, sy] = w2s(n.x, n.y);
  const selected = state.sel && state.sel.kind === 'node' && state.sel.id === n.id;
  const rs = state.results ? state.resNode[n.id] : null;
  let fill = TYPE_COLOR[n.type] || '#334155';
  if (rs) {
    const r = metricRange(state.results.nodes, state.nodeColor);
    fill = colorScale(norm(rs[state.nodeColor][state.timeIndex], r));
  }
  if (selected) {
    ctx.fillStyle = 'rgba(37,99,235,.18)';
    ctx.beginPath(); ctx.arc(sx, sy, 15, 0, 7); ctx.fill();
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 13, 0, 7); ctx.stroke();
  }
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff';
  if (n.type === 'RESERVOIR') {
    ctx.fillStyle = fill; roundRect(sx - 9, sy - 7, 18, 14, 3); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(sx - 6, sy - 1); ctx.quadraticCurveTo(sx - 3, sy - 4, sx, sy - 1); ctx.quadraticCurveTo(sx + 3, sy + 2, sx + 6, sy - 1); ctx.stroke();
  } else if (n.type === 'TANK') {
    ctx.fillStyle = fill; roundRect(sx - 7, sy - 9, 14, 18, 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx - 7, sy - 3); ctx.lineTo(sx + 7, sy - 3); ctx.stroke();
  } else {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, 7); ctx.fill(); ctx.stroke();
  }
  if (state.view.scale > 0.3) {
    ctx.fillStyle = selected ? '#2563eb' : '#334155';
    ctx.font = (selected ? 'bold ' : '') + '11px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(n.id, sx, sy + 20);
    if (rs) {
      const v = rs[state.nodeColor][state.timeIndex];
      ctx.fillStyle = '#64748b'; ctx.font = '9px Consolas, monospace';
      ctx.fillText(fmt(v), sx, sy + 31);
    }
  }
}

function drawDraft() {
  const a = nodeById(state.draft.from); if (!a) return;
  const [ax, ay] = w2s(a.x, a.y);
  const [bx, by] = w2s(state.draft.wx, state.draft.wy);
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ============================ color scale ============================ */
const SCALE = [[0, '#2c7bb6'], [0.25, '#00a6ca'], [0.5, '#7fbc41'], [0.75, '#f9d057'], [1, '#d7191c']];
function hexRgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function colorScale(t) {
  t = Math.max(0, Math.min(1, t || 0));
  for (let i = 0; i < SCALE.length - 1; i++) {
    const [t0, c0] = SCALE[i], [t1, c1] = SCALE[i + 1];
    if (t <= t1) { const f = (t - t0) / (t1 - t0); const a = hexRgb(c0), b = hexRgb(c1); return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`; }
  }
  return SCALE[SCALE.length - 1][1];
}
function norm(v, r) { return r.max > r.min ? (v - r.min) / (r.max - r.min) : 0.5; }
const _rangeCache = {};
function metricRange(series, key) {
  const ck = key + ':' + series.length + ':' + (series[0] ? series[0][key].length : 0);
  if (_rangeCache[ck]) return _rangeCache[ck];
  let min = Infinity, max = -Infinity;
  series.forEach(s => (s[key] || []).forEach(v => { if (v < min) min = v; if (v > max) max = v; }));
  if (!isFinite(min)) { min = 0; max = 1; }
  return (_rangeCache[ck] = { min, max });
}

/* ============================ hit testing ============================ */
function hitTest(sx, sy) {
  for (let i = state.net.nodes.length - 1; i >= 0; i--) {
    const n = state.net.nodes[i]; const [nx, ny] = w2s(n.x, n.y);
    if (Math.hypot(sx - nx, sy - ny) < 11) return { kind: 'node', id: n.id };
  }
  for (let i = state.net.links.length - 1; i >= 0; i--) {
    const pts = linkPoints(state.net.links[i]); if (!pts) continue;
    for (let j = 1; j < pts.length; j++) {
      if (distToSeg(sx, sy, pts[j - 1], pts[j]) < 6) return { kind: 'link', id: state.net.links[i].id };
    }
  }
  return null;
}
function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/* ============================ interaction ============================ */
canvas.addEventListener('mousedown', (e) => {
  const [sx, sy] = mousePos(e);
  const hit = hitTest(sx, sy);
  state.drag = { sx, sy, moved: false, mode: null };
  if (state.tool === 'select') {
    if (hit && hit.kind === 'node') { select(hit); state.drag.mode = 'node'; state.drag.id = hit.id; }
    else if (hit) { select(hit); state.drag.mode = 'none'; }
    else { state.drag.mode = 'pan'; state.drag.panX = state.view.panX; state.drag.panY = state.view.panY; }
  }
});

canvas.addEventListener('mousemove', (e) => {
  const [sx, sy] = mousePos(e);
  const [wx, wy] = s2w(sx, sy);
  state.mouse = { sx, sy, wx, wy };
  const geo = state.net.geo;
  if (geo && geo.enabled) {
    const [mx, my] = netToMerc(wx, wy);
    $('coordReadout').textContent = `lat ${myToLat(my).toFixed(5)}  lon ${mxToLon(mx).toFixed(5)}`;
  } else {
    $('coordReadout').textContent = `x ${wx.toFixed(1)}  y ${wy.toFixed(1)}`;
  }
  if (state.draft) { state.draft.wx = wx; state.draft.wy = wy; render(); }
  if (!state.drag) {
    const h = hitTest(sx, sy);
    canvas.style.cursor = state.tool === 'select' ? (h ? 'pointer' : 'grab') : 'crosshair';
    return;
  }
  const dx = sx - state.drag.sx, dy = sy - state.drag.sy;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.drag.moved = true;
  if (state.drag.mode === 'pan') {
    state.view.panX = state.drag.panX + dx; state.view.panY = state.drag.panY + dy; render();
  } else if (state.drag.mode === 'node' && state.drag.moved) {
    const n = nodeById(state.drag.id); if (n) { n.x = wx; n.y = wy; markDirty(false); render(); }
  }
});

window.addEventListener('mouseup', (e) => {
  if (!state.drag) return;
  const [sx, sy] = mousePos(e);
  const moved = state.drag.moved;
  const wasPan = state.drag.mode === 'pan';
  state.drag = null;
  if (moved) { if (state.drag === null && wasPan) return; render(); return; }
  // click (no movement)
  const hit = hitTest(sx, sy);
  const tool = state.tool;
  if (tool === 'junction' || tool === 'reservoir' || tool === 'tank') {
    const [wx, wy] = s2w(sx, sy); addNode(tool, wx, wy);
  } else if (tool === 'pipe' || tool === 'pump' || tool === 'valve') {
    if (hit && hit.kind === 'node') handleLinkClick(hit.id);
    else { state.draft = null; render(); }
  } else if (tool === 'select') {
    if (!hit) select(null);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [sx, sy] = mousePos(e);
  const [wx, wy] = s2w(sx, sy);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  state.view.scale = Math.max(0.05, state.view.scale * factor);
  state.view.panX = sx - wx * state.view.scale;
  state.view.panY = sy + wy * state.view.scale;
  render();
}, { passive: false });

function mousePos(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function handleLinkClick(nodeId) {
  if (!state.draft) { state.draft = { from: nodeId, wx: state.mouse.wx, wy: state.mouse.wy }; render(); return; }
  if (state.draft.from === nodeId) { state.draft = null; render(); return; }
  const type = state.tool === 'pipe' ? 'PIPE' : state.tool === 'pump' ? 'PUMP' : 'PRV';
  addLink(type, state.draft.from, nodeId);
  state.draft = null; render();
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const map = { v: 'select', j: 'junction', r: 'reservoir', t: 'tank', p: 'pipe', m: 'pump', a: 'valve' };
  if (map[k]) { setTool(map[k]); }
  else if (k === 'delete' || k === 'backspace') { deleteSelection(); }
  else if (k === 'escape') { state.draft = null; select(null); render(); }
  else if (k === 'f') { fitView(); }
  else if (k === ' ') { if (state.results) { e.preventDefault(); togglePlay(); } }
});

/* ============================ editing ============================ */
function genId(prefix, arr) { let i = 1; const ids = new Set(arr.map(x => x.id)); while (ids.has(prefix + i)) i++; return prefix + i; }

function addNode(tool, wx, wy) {
  const type = tool.toUpperCase();
  const prefix = type === 'JUNCTION' ? 'J' : type === 'RESERVOIR' ? 'R' : 'T';
  const n = { id: genId(prefix, state.net.nodes), type, x: Math.round(wx), y: Math.round(wy), elevation: 0, demand: 0, demandPattern: '', head: 50, headPattern: '', initLevel: 5, minLevel: 0, maxLevel: 10, diameter: 20, minVol: 0, volCurve: '', initQual: 0 };
  if (type === 'RESERVOIR') n.head = 50;
  state.net.nodes.push(n);
  markDirty(true); select({ kind: 'node', id: n.id }); renderElemList(); render();
}

function addLink(type, from, to) {
  if (state.net.links.some(l => (l.from === from && l.to === to) || (l.from === to && l.to === from))) { toast(t('err.linkExists'), 'err'); return; }
  const prefix = type === 'PIPE' ? 'P' : type === 'PUMP' ? 'PUMP' : 'V';
  const l = { id: genId(prefix, state.net.links), type, from, to, length: 300, diameter: 200, roughness: 100, minorLoss: 0, status: 'OPEN', power: 0, headCurve: '', speed: 1, speedPattern: '', setting: 20, vertices: [] };
  if (type === 'PUMP') { l.power = 0; l.headCurve = state.net.curves[0] ? state.net.curves[0].id : ''; }
  state.net.links.push(l);
  markDirty(true); select({ kind: 'link', id: l.id }); renderElemList(); render();
}

function deleteSelection() {
  if (!state.sel) return;
  if (state.sel.kind === 'node') {
    const id = state.sel.id;
    state.net.nodes = state.net.nodes.filter(n => n.id !== id);
    state.net.links = state.net.links.filter(l => l.from !== id && l.to !== id);
  } else {
    state.net.links = state.net.links.filter(l => l.id !== state.sel.id);
  }
  select(null); markDirty(true); renderElemList(); render();
}

function select(sel) {
  state.sel = sel;
  buildPropsForm();
  renderElemList();
  highlightTableRow();
  render();
}

function markDirty(structural) {
  if (state.results) {
    if (structural) { clearResults(); }
    else { state.stale = true; updateRunButton(); }
  }
  autosave();
}

/* ============================ tools / tabs ============================ */
function setTool(tool) {
  state.tool = tool; state.draft = null;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  const hints = { select: t('hint.select'), junction: t('hint.junction'), reservoir: t('hint.reservoir'), tank: t('hint.tank'), pipe: t('hint.pipe'), pump: t('hint.pump'), valve: t('hint.valve') };
  $('canvasHint').textContent = hints[tool] || '';
  render();
}
$('tools').addEventListener('click', e => { const b = e.target.closest('.tool'); if (b) setTool(b.dataset.tool); });

document.querySelectorAll('.etab').forEach(b => b.addEventListener('click', () => {
  state.elemTab = b.dataset.etab;
  document.querySelectorAll('.etab').forEach(x => x.classList.toggle('active', x === b));
  renderElemList();
}));
document.querySelectorAll('.rtab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.rtab').forEach(x => x.classList.toggle('active', x === b));
  $('propsPanel').hidden = b.dataset.rtab !== 'props';
  $('settingsPanel').hidden = b.dataset.rtab !== 'settings';
}));

/* ============================ element list ============================ */
function renderElemList() {
  const list = $('elemList');
  const items = state.elemTab === 'nodes' ? state.net.nodes : state.net.links;
  $('elemCount').textContent = t('elem.count', state.net.nodes.length, state.net.links.length);
  list.innerHTML = '';
  items.forEach(it => {
    const kind = state.elemTab === 'nodes' ? 'node' : 'link';
    const div = document.createElement('div');
    div.className = 'elem-item' + (state.sel && state.sel.kind === kind && state.sel.id === it.id ? ' sel' : '');
    const color = kind === 'node' ? (TYPE_COLOR[it.type] || '#334155') : linkColorBase(it.type);
    const sub = kind === 'node' ? it.type : `${it.from}→${it.to}`;
    div.innerHTML = `<span class="swatch" style="background:${color}"></span><span class="eid">${esc(it.id)}</span><span class="etype">${esc(sub)}</span>`;
    div.addEventListener('click', () => { select({ kind, id: it.id }); centerOn(it); });
    list.appendChild(div);
  });
  if (!items.length) list.innerHTML = `<div class="empty-hint">${esc(t('elem.empty'))}</div>`;
}
function centerOn(it) {
  let wx, wy;
  if (it.type && nodeById(it.id)) { wx = it.x; wy = it.y; }
  else { const a = nodeById(it.from), b = nodeById(it.to); if (!a || !b) return; wx = (a.x + b.x) / 2; wy = (a.y + b.y) / 2; }
  state.view.panX = canvas.clientWidth / 2 - wx * state.view.scale;
  state.view.panY = canvas.clientHeight / 2 + wy * state.view.scale;
  render();
}

/* ============================ property form ============================ */
function field(label, input) {
  const d = document.createElement('div'); d.className = 'field';
  const l = document.createElement('label'); l.textContent = label; d.appendChild(l); d.appendChild(input); return d;
}
function numInput(val, onch, step) {
  const i = document.createElement('input'); i.type = 'number'; i.value = val; i.step = step || 'any';
  i.addEventListener('change', () => onch(parseFloat(i.value) || 0)); return i;
}
function textInput(val, onch) {
  const i = document.createElement('input'); i.type = 'text'; i.value = val || '';
  i.addEventListener('change', () => onch(i.value.trim())); return i;
}
function selectInput(val, opts, onch) {
  const s = document.createElement('select');
  opts.forEach(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; const op = document.createElement('option'); op.value = v; op.textContent = t; if (v === val) op.selected = true; s.appendChild(op); });
  s.addEventListener('change', () => onch(s.value)); return s;
}
function patternOptions() { return [['', t('opt.none')], ...state.net.patterns.map(p => [p.id, p.id])]; }
function curveOptions() { return [['', t('opt.none')], ...state.net.curves.map(c => [c.id, c.id])]; }
function nodeOptions() { return state.net.nodes.map(n => [n.id, n.id]); }

function buildPropsForm() {
  const form = $('propsForm'); const empty = $('propsEmpty');
  form.innerHTML = '';
  const obj = selObj();
  if (!obj) { empty.hidden = false; return; }
  empty.hidden = true;
  const isNode = state.sel.kind === 'node';

  const head = document.createElement('div'); head.className = 'prop-header';
  head.innerHTML = `<span class="badge">${obj.type}</span><span class="pid">${esc(obj.id)}</span>`;
  form.appendChild(head);

  // ID
  form.appendChild(field(t('prop.id'), textInput(obj.id, v => renameId(v))));

  if (isNode) {
    const row = document.createElement('div'); row.className = 'field-row';
    row.appendChild(field('X', numInput(obj.x, v => { obj.x = v; markDirty(false); render(); })));
    row.appendChild(field('Y', numInput(obj.y, v => { obj.y = v; markDirty(false); render(); })));
    form.appendChild(row);
    if (obj.type === 'JUNCTION') {
      form.appendChild(field(t('prop.elev'), numInput(obj.elevation, v => { obj.elevation = v; markDirty(false); })));
      form.appendChild(field(t('prop.baseDemand'), numInput(obj.demand, v => { obj.demand = v; markDirty(false); })));
      form.appendChild(field(t('prop.demandPat'), selectInput(obj.demandPattern, patternOptions(), v => { obj.demandPattern = v; markDirty(false); })));
    } else if (obj.type === 'RESERVOIR') {
      form.appendChild(field(t('prop.head'), numInput(obj.head, v => { obj.head = v; markDirty(false); })));
      form.appendChild(field(t('prop.headPat'), selectInput(obj.headPattern, patternOptions(), v => { obj.headPattern = v; markDirty(false); })));
    } else if (obj.type === 'TANK') {
      form.appendChild(field(t('prop.tankElev'), numInput(obj.elevation, v => { obj.elevation = v; markDirty(false); })));
      const r1 = document.createElement('div'); r1.className = 'field-row';
      r1.appendChild(field(t('prop.initLevel'), numInput(obj.initLevel, v => { obj.initLevel = v; markDirty(false); })));
      r1.appendChild(field(t('prop.diamM'), numInput(obj.diameter, v => { obj.diameter = v; markDirty(false); })));
      form.appendChild(r1);
      const r2 = document.createElement('div'); r2.className = 'field-row';
      r2.appendChild(field(t('prop.minLevel'), numInput(obj.minLevel, v => { obj.minLevel = v; markDirty(false); })));
      r2.appendChild(field(t('prop.maxLevel'), numInput(obj.maxLevel, v => { obj.maxLevel = v; markDirty(false); })));
      form.appendChild(r2);
      form.appendChild(field(t('prop.minVol'), numInput(obj.minVol, v => { obj.minVol = v; markDirty(false); })));
      form.appendChild(field(t('prop.volCurve'), selectInput(obj.volCurve, curveOptions(), v => { obj.volCurve = v; markDirty(false); })));
    }
    form.appendChild(field(t('prop.initQual'), numInput(obj.initQual, v => { obj.initQual = v; markDirty(false); })));
  } else {
    const row = document.createElement('div'); row.className = 'field-row';
    row.appendChild(field(t('prop.from'), selectInput(obj.from, nodeOptions(), v => { obj.from = v; markDirty(true); render(); })));
    row.appendChild(field(t('prop.to'), selectInput(obj.to, nodeOptions(), v => { obj.to = v; markDirty(true); render(); })));
    form.appendChild(row);
    if (obj.type === 'PIPE') {
      form.appendChild(field(t('prop.length'), numInput(obj.length, v => { obj.length = v; markDirty(false); })));
      form.appendChild(field(t('prop.diamMm'), numInput(obj.diameter, v => { obj.diameter = v; markDirty(false); })));
      form.appendChild(field(t('prop.rough'), numInput(obj.roughness, v => { obj.roughness = v; markDirty(false); })));
      form.appendChild(field(t('prop.minorLoss'), numInput(obj.minorLoss, v => { obj.minorLoss = v; markDirty(false); })));
      form.appendChild(field(t('prop.initStatus'), selectInput(obj.status, [['OPEN', t('status.open')], ['CLOSED', t('status.closed')], ['CV', t('status.cv')]], v => { obj.status = v; markDirty(false); render(); })));
    } else if (obj.type === 'PUMP') {
      form.appendChild(field(t('prop.headCurve'), selectInput(obj.headCurve, curveOptions(), v => { obj.headCurve = v; markDirty(false); })));
      form.appendChild(field(t('prop.power'), numInput(obj.power, v => { obj.power = v; markDirty(false); })));
      form.appendChild(field(t('prop.speed'), numInput(obj.speed, v => { obj.speed = v; markDirty(false); }, '0.1')));
      form.appendChild(field(t('prop.speedPat'), selectInput(obj.speedPattern, patternOptions(), v => { obj.speedPattern = v; markDirty(false); })));
    } else {
      form.appendChild(field(t('prop.valveType'), selectInput(obj.type, VALVE_TYPES, v => { obj.type = v; markDirty(false); buildPropsForm(); render(); })));
      form.appendChild(field(t('prop.diamMm'), numInput(obj.diameter, v => { obj.diameter = v; markDirty(false); })));
      if (obj.type === 'GPV') form.appendChild(field(t('prop.hlossCurve'), selectInput(obj.headCurve, curveOptions(), v => { obj.headCurve = v; markDirty(false); })));
      else form.appendChild(field(t('prop.setting'), numInput(obj.setting, v => { obj.setting = v; markDirty(false); })));
      form.appendChild(field(t('prop.minorLoss'), numInput(obj.minorLoss, v => { obj.minorLoss = v; markDirty(false); })));
    }
  }

  // result readout
  if (state.results) {
    const rs = isNode ? state.resNode[obj.id] : state.resLink[obj.id];
    if (rs) form.appendChild(resultReadout(rs, isNode));
  }

  const del = document.createElement('button'); del.className = 'btn btn-delete'; del.textContent = t('prop.delete');
  del.addEventListener('click', deleteSelection); form.appendChild(del);
}

function resultReadout(rs, isNode) {
  const ti = state.timeIndex; const u = state.results.units;
  const box = document.createElement('div'); box.className = 'result-readout';
  const rows = isNode
    ? [[t('m.pressure'), rs.pressure[ti], u.pressure], [t('m.head'), rs.head[ti], u.head], [t('m.demand'), rs.demand[ti], u.flow]]
    : [[t('m.flow'), rs.flow[ti], u.flow], [t('m.velocity'), rs.velocity[ti], u.velocity], [t('m.headloss'), rs.headloss[ti], u.headloss], [t('m.status'), rs.status[ti] > 0.5 ? t('status.open') : t('status.closed'), '']];
  if (isNode && u.quality) rows.push([t('m.quality'), rs.quality[ti], u.quality]);
  box.innerHTML = `<div class="prop-section-title" style="margin-top:0">${esc(t('prop.currentResult'))}</div>` +
    rows.map(([k, v, un]) => `<div class="rr-row"><span>${esc(k)}</span><span>${typeof v === 'number' ? fmt(v) : esc(v)} ${un}</span></div>`).join('');
  return box;
}

function renameId(v) {
  if (!v || !state.sel) return;
  const obj = selObj(); const old = obj.id;
  if (v === old) return;
  const arr = state.sel.kind === 'node' ? state.net.nodes : state.net.links;
  if (arr.some(x => x.id === v)) { toast(t('err.idExists'), 'err'); buildPropsForm(); return; }
  obj.id = v;
  if (state.sel.kind === 'node') state.net.links.forEach(l => { if (l.from === old) l.from = v; if (l.to === old) l.to = v; });
  state.sel.id = v;
  markDirty(true); renderElemList(); buildPropsForm(); render();
}

/* ============================ settings panel ============================ */
function buildSettings() {
  const p = $('settingsPanel'); p.innerHTML = '';
  const o = state.net.options, tm = state.net.times, q = state.net.quality;
  p.appendChild(field(t('set.title'), textInput(state.net.title, v => { state.net.title = v; autosave(); })));

  p.appendChild(sectionTitle(t('set.analysis')));
  p.appendChild(field(t('set.flowUnits'), selectInput(o.flowUnits, [['LPS', t('unit.lps')], ['LPM', t('unit.lpm')], ['CMH', t('unit.cmh')], ['CMD', t('unit.cmd')], ['CMS', t('unit.cms')], ['MLD', t('unit.mld')], ['GPM', t('unit.gpm')], ['CFS', t('unit.cfs')], ['MGD', t('unit.mgd')]], v => { o.flowUnits = v; markDirty(false); })));
  p.appendChild(field(t('set.headLoss'), selectInput(o.headLoss, [['H-W', 'Hazen-Williams'], ['D-W', 'Darcy-Weisbach'], ['C-M', 'Chezy-Manning']], v => { o.headLoss = v; markDirty(false); })));
  p.appendChild(field(t('set.demandMult'), numInput(o.demandMult, v => { o.demandMult = v; markDirty(false); }, '0.1')));
  const r = document.createElement('div'); r.className = 'field-row';
  r.appendChild(field(t('set.trials'), numInput(o.trials, v => { o.trials = v; markDirty(false); }, '1')));
  r.appendChild(field(t('set.accuracy'), numInput(o.accuracy, v => { o.accuracy = v; markDirty(false); }, '0.0001')));
  p.appendChild(r);

  p.appendChild(sectionTitle(t('set.time')));
  p.appendChild(field(t('set.duration'), numInput(tm.duration / 3600, v => { tm.duration = Math.round(v * 3600); markDirty(false); }, '1')));
  const r2 = document.createElement('div'); r2.className = 'field-row';
  r2.appendChild(field(t('set.hydStep'), numInput(tm.hydStep / 3600, v => { tm.hydStep = Math.max(1, Math.round(v * 3600)); markDirty(false); }, '0.5')));
  r2.appendChild(field(t('set.reportStep'), numInput(tm.reportStep / 3600, v => { tm.reportStep = Math.max(1, Math.round(v * 3600)); markDirty(false); }, '0.5')));
  p.appendChild(r2);
  const r3 = document.createElement('div'); r3.className = 'field-row';
  r3.appendChild(field(t('set.patternStep'), numInput(tm.patternStep / 3600, v => { tm.patternStep = Math.max(1, Math.round(v * 3600)); markDirty(false); }, '0.5')));
  r3.appendChild(field(t('set.startClock'), numInput(tm.startClock / 3600, v => { tm.startClock = Math.round(v * 3600); markDirty(false); }, '1')));
  p.appendChild(r3);
  p.appendChild(field(t('set.statistic'), selectInput(tm.statistic, [['NONE', t('stat.series')], ['AVERAGED', t('stat.avg')], ['MINIMUM', t('stat.min')], ['MAXIMUM', t('stat.max')], ['RANGE', t('stat.range')]], v => { tm.statistic = v; markDirty(false); })));

  p.appendChild(sectionTitle(t('set.quality')));
  p.appendChild(field(t('set.qualType'), selectInput(q.type, [['NONE', t('qual.none')], ['CHEM', t('qual.chem')], ['AGE', t('qual.age')], ['TRACE', t('qual.trace')]], v => { q.type = v; markDirty(false); buildSettings(); })));
  if (q.type === 'CHEM') {
    const rq = document.createElement('div'); rq.className = 'field-row';
    rq.appendChild(field(t('set.chemName'), textInput(q.chemName, v => { q.chemName = v; markDirty(false); })));
    rq.appendChild(field(t('set.chemUnits'), textInput(q.chemUnits, v => { q.chemUnits = v; markDirty(false); })));
    p.appendChild(rq);
  } else if (q.type === 'TRACE') {
    p.appendChild(field(t('set.traceNode'), selectInput(q.traceNode, [['', t('opt.select')], ...nodeOptions()], v => { q.traceNode = v; markDirty(false); })));
  }
}
function sectionTitle(txt) { const d = document.createElement('div'); d.className = 'prop-section-title'; d.textContent = txt; return d; }

/* ============================ map panel / controls ============================ */
function buildMapPanel() {
  const p = $('mapPanel'); p.innerHTML = '';
  const g = state.net.geo;
  p.appendChild(sectionTitle(t('map.layer')));
  p.appendChild(field(t('map.source'), selectInput(g.source, TILE_SOURCES.map(s => [s.id, t(s.nameKey)]), v => { g.source = v; markDirty(false); render(); updateAttribution(); })));
  const op = document.createElement('input'); op.type = 'range'; op.min = '0'; op.max = '1'; op.step = '0.05'; op.value = g.opacity;
  op.addEventListener('input', () => { g.opacity = parseFloat(op.value); render(); autosave(); });
  p.appendChild(field(t('map.opacity'), op));

  p.appendChild(sectionTitle(t('map.geo')));
  const hint = document.createElement('div'); hint.className = 'map-hint'; hint.textContent = t('map.hint'); p.appendChild(hint);
  const r1 = document.createElement('div'); r1.className = 'field-row';
  r1.appendChild(field(t('map.lat'), numInput(g.lat, v => { g.lat = Math.max(-85, Math.min(85, v)); markDirty(false); render(); }, '0.0001')));
  r1.appendChild(field(t('map.lon'), numInput(g.lon, v => { g.lon = Math.max(-180, Math.min(180, v)); markDirty(false); render(); }, '0.0001')));
  p.appendChild(r1);
  const r2 = document.createElement('div'); r2.className = 'field-row';
  r2.appendChild(field(t('map.scale'), numInput(g.scale, v => { g.scale = Math.max(1e-6, v); markDirty(false); render(); }, '0.1')));
  r2.appendChild(field(t('map.rot'), numInput(g.rot, v => { g.rot = v; markDirty(false); render(); }, '1')));
  p.appendChild(r2);
  p.appendChild(field(t('map.anchor'), selectInput(g.anchorNode, [['', t('map.anchorOrigin')], ...nodeOptions()], v => {
    g.anchorNode = v;
    if (v) { const n = nodeById(v); if (n) { g.ax = n.x; g.ay = n.y; } }
    else { g.ax = 0; g.ay = 0; }
    markDirty(false); buildMapPanel(); render();
  })));
  const fit = document.createElement('button'); fit.className = 'btn btn-sm'; fit.textContent = t('map.fit');
  fit.addEventListener('click', fitView); p.appendChild(fit);
}
function updateAttribution() {
  const el = $('mapAttribution'); const g = state.net.geo;
  if (g && g.enabled) { el.textContent = tileSource(g.source).attr; el.hidden = false; }
  else el.hidden = true;
}
function syncMapUI() {
  const g = state.net.geo;
  $('btnMapToggle').classList.toggle('active', !!(g && g.enabled));
  updateAttribution();
  if (!$('mapPanel').hidden) buildMapPanel();
}
$('btnMapToggle').addEventListener('click', () => {
  const g = state.net.geo;
  g.enabled = !g.enabled;
  markDirty(false); syncMapUI(); render();
  toast(g.enabled ? t('toast.mapOn') : t('toast.mapOff'));
});
$('btnMapSettings').addEventListener('click', () => {
  const p = $('mapPanel');
  p.hidden = !p.hidden;
  $('btnMapSettings').classList.toggle('active', !p.hidden);
  if (!p.hidden) buildMapPanel();
});

/* ============================ data modal ============================ */
function openData() {
  const pl = $('patternList'); pl.innerHTML = '';
  state.net.patterns.forEach(p => pl.appendChild(patternRow(p.id, p.values.join(', '))));
  const cl = $('curveList'); cl.innerHTML = '';
  state.net.curves.forEach(c => cl.appendChild(curveRow(c.id, c.type, c.points.map(pt => `${pt.x},${pt.y}`).join('\n'))));
  $('controlsText').value = state.net.controls.join('\n');
  $('dataModal').hidden = false;
}
function patternRow(id, vals) {
  const row = document.createElement('div'); row.className = 'data-row';
  row.innerHTML = `<input type="text" class="did" value="${esc(id)}" placeholder="${esc(t('data.patternId'))}"><textarea class="dvals" rows="2" placeholder="1, 1.2, 0.8 ...">${esc(vals)}</textarea><button class="btn btn-del-row">✕</button>`;
  row.querySelector('.btn-del-row').addEventListener('click', () => row.remove());
  return row;
}
function curveRow(id, type, pts) {
  const row = document.createElement('div'); row.className = 'data-row';
  const opts = ['PUMP', 'EFFICIENCY', 'VOLUME', 'HEADLOSS', 'GENERIC'].map(ct => `<option ${ct === type ? 'selected' : ''}>${ct}</option>`).join('');
  row.innerHTML = `<input type="text" class="did" value="${esc(id)}" placeholder="${esc(t('data.curveId'))}"><select class="dtype">${opts}</select><textarea class="dvals" rows="2" placeholder="0,55&#10;40,45&#10;80,25">${esc(pts)}</textarea><button class="btn btn-del-row">✕</button>`;
  row.querySelector('.btn-del-row').addEventListener('click', () => row.remove());
  return row;
}
function applyData() {
  const patterns = [];
  $('patternList').querySelectorAll('.data-row').forEach(r => {
    const id = r.querySelector('.did').value.trim(); if (!id) return;
    const vals = r.querySelector('.dvals').value.split(/[,\s]+/).map(parseFloat).filter(v => !isNaN(v));
    patterns.push({ id, values: vals.length ? vals : [1] });
  });
  const curves = [];
  $('curveList').querySelectorAll('.data-row').forEach(r => {
    const id = r.querySelector('.did').value.trim(); if (!id) return;
    const type = r.querySelector('.dtype').value;
    const points = r.querySelector('.dvals').value.split('\n').map(line => {
      const [x, y] = line.split(/[,\s]+/).map(parseFloat); return (!isNaN(x) && !isNaN(y)) ? { x, y } : null;
    }).filter(Boolean);
    curves.push({ id, type, points });
  });
  const controls = $('controlsText').value.split('\n').map(s => s.trim()).filter(Boolean);
  state.net.patterns = patterns; state.net.curves = curves; state.net.controls = controls;
  $('dataModal').hidden = true; markDirty(true); buildSettings(); toast(t('toast.dataApplied'), 'ok');
}
$('btnAddPattern').addEventListener('click', () => $('patternList').appendChild(patternRow(genId('PAT', state.net.patterns), '1, 1, 1, 1')));
$('btnAddCurve').addEventListener('click', () => $('curveList').appendChild(curveRow(genId('C', state.net.curves), 'PUMP', '0,50\n50,30')));
$('btnData').addEventListener('click', openData);
$('btnCloseData').addEventListener('click', () => $('dataModal').hidden = true);
$('btnApplyData').addEventListener('click', applyData);

/* ============================ simulation ============================ */
async function runSim() {
  if (!state.net.nodes.length) { toast(t('err.drawFirst'), 'err'); return; }
  const btn = $('btnRun'); btn.disabled = true; btn.textContent = t('btn.running');
  try {
    const res = await api('/api/simulate', 'POST', state.net);
    if (!res.ok) { toast(res.error || t('err.simFailed'), 'err'); return; }
    state.results = res; state.stale = false; state.timeIndex = 0;
    state.resNode = {}; state.resLink = {};
    res.nodes.forEach(n => state.resNode[n.id] = n);
    res.links.forEach(l => state.resLink[l.id] = l);
    for (const k in _rangeCache) delete _rangeCache[k];
    showResults();
    const w = res.warnings && res.warnings.length ? t('toast.warnCount', res.warnings.length) : '';
    toast(t('toast.simDone', res.times.length, w), 'ok');
  } catch (e) { toast(t('err.request') + e.message, 'err'); }
  finally { btn.disabled = false; updateRunButton(); }
}

function showResults() {
  $('resultBar').hidden = false; $('resultsPanel').hidden = false;
  const slider = $('timeSlider'); slider.max = state.results.times.length - 1; slider.value = 0;
  if (state.results.units.quality) { $('nodeColor').querySelector('option[value=quality]').disabled = false; }
  else { $('nodeColor').querySelector('option[value=quality]').disabled = true; if (state.nodeColor === 'quality') { state.nodeColor = 'pressure'; $('nodeColor').value = 'pressure'; } }
  updateTimeUI(); renderTables(); renderLegend(); buildPropsForm(); render();
  $('rpSummary').textContent = t('rp.summary', state.results.nodes.length, state.results.links.length, state.results.times.length);
}
function clearResults() {
  state.results = null; state.resNode = {}; state.resLink = {}; state.playing = false; state.stale = false;
  $('resultBar').hidden = true; $('resultsPanel').hidden = true; updateRunButton();
  stopPlay(); render();
}
function updateTimeUI() {
  const sec = state.results.times[state.timeIndex];
  $('timeLabel').textContent = 't = ' + clock(sec);
  $('timeSlider').value = state.timeIndex;
}
$('timeSlider').addEventListener('input', e => { state.timeIndex = +e.target.value; updateTimeUI(); renderTables(); renderLegend(); buildPropsForm(); render(); });
$('nodeColor').addEventListener('change', e => { state.nodeColor = e.target.value; renderLegend(); render(); });
$('linkColor').addEventListener('change', e => { state.linkColor = e.target.value; renderLegend(); render(); });
$('btnCloseResults').addEventListener('click', clearResults);

let playTimer = null;
function togglePlay() { state.playing ? stopPlay() : startPlay(); }
function startPlay() {
  if (!state.results) return; state.playing = true; $('btnPlay').textContent = '⏸';
  playTimer = setInterval(() => {
    state.timeIndex = (state.timeIndex + 1) % state.results.times.length;
    updateTimeUI(); renderTables(); renderLegend(); render();
  }, 700);
}
function stopPlay() { state.playing = false; $('btnPlay').textContent = '▶'; if (playTimer) clearInterval(playTimer); playTimer = null; }
$('btnPlay').addEventListener('click', togglePlay);

function renderLegend() {
  const el = $('legend'); if (!state.results) { el.innerHTML = ''; return; }
  const u = state.results.units;
  const nr = metricRange(state.results.nodes, state.nodeColor);
  const unit = state.nodeColor === 'pressure' ? u.pressure : state.nodeColor === 'head' ? u.head : state.nodeColor === 'demand' ? u.flow : u.quality;
  const grad = `linear-gradient(90deg, ${SCALE.map(s => s[1]).join(',')})`;
  el.innerHTML = `<span>${labelFor(state.nodeColor)}</span><span class="legend-gradient" style="background:${grad}"></span><span>${fmt(nr.min)} ~ ${fmt(nr.max)} ${unit}</span>`;
}
function labelFor(k) { return t('m.' + k) !== 'm.' + k ? t('m.' + k) : k; }

/* ============================ result tables ============================ */
document.querySelectorAll('.rptab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.rptab').forEach(x => x.classList.toggle('active', x === b));
  const tab = b.dataset.rptab;
  $('nodeTableWrap').hidden = tab !== 'nodes'; $('linkTableWrap').hidden = tab !== 'links'; $('warningsWrap').hidden = tab !== 'warnings';
}));
$('btnToggleResults').addEventListener('click', () => $('resultsPanel').classList.toggle('collapsed'));

function renderTables() {
  if (!state.results) return;
  const ti = state.timeIndex, u = state.results.units;
  // nodes
  let h = `<table><thead><tr><th>${t('th.id')}</th><th>${t('th.type')}</th><th>${t('th.elev')}</th><th>${t('th.pressure')} (${u.pressure})</th><th>${t('th.head')} (${u.head})</th><th>${t('th.demand')} (${u.flow})</th>`;
  if (u.quality) h += `<th>${t('th.quality')} (${u.quality})</th>`;
  h += `</tr></thead><tbody>`;
  state.results.nodes.forEach(n => {
    const p = n.pressure[ti]; const bad = n.type === 'JUNCTION' && p < 0;
    h += `<tr data-kind="node" data-id="${esc(n.id)}"><td>${esc(n.id)}</td><td>${n.type}</td><td class="num">${fmt(nodeById(n.id) ? nodeById(n.id).elevation : 0)}</td><td class="num ${bad ? 'cell-bad' : ''}">${fmt(p)}</td><td class="num">${fmt(n.head[ti])}</td><td class="num">${fmt(n.demand[ti])}</td>`;
    if (u.quality) h += `<td class="num">${fmt(n.quality[ti])}</td>`;
    h += `</tr>`;
  });
  h += `</tbody></table>`;
  $('nodeTableWrap').innerHTML = h;
  // links
  let hl = `<table><thead><tr><th>${t('th.id')}</th><th>${t('th.type')}</th><th>${t('th.fromTo')}</th><th>${t('th.flow')} (${u.flow})</th><th>${t('th.velocity')} (${u.velocity})</th><th>${t('th.headloss')} (${u.headloss})</th><th>${t('th.status')}</th></tr></thead><tbody>`;
  state.results.links.forEach(l => {
    const st = l.status[ti] > 0.5 ? t('status.open') : t('status.closed');
    const vwarn = Math.abs(l.velocity[ti]) > 2 ? 'cell-warn' : '';
    hl += `<tr data-kind="link" data-id="${esc(l.id)}"><td>${esc(l.id)}</td><td>${l.type}</td><td>${esc(l.from)}→${esc(l.to)}</td><td class="num">${fmt(l.flow[ti])}</td><td class="num ${vwarn}">${fmt(l.velocity[ti])}</td><td class="num">${fmt(l.headloss[ti])}</td><td>${st}</td></tr>`;
  });
  hl += `</tbody></table>`;
  $('linkTableWrap').innerHTML = hl;
  // warnings
  const ws = state.results.warnings || [];
  $('warningsWrap').innerHTML = ws.length ? ws.map(w => `<div class="warn-item">⚠ ${esc(w)}</div>`).join('') : `<div class="warn-none">${esc(t('warn.none'))}</div>`;
  document.querySelector('.rptab[data-rptab=warnings]').textContent = ' ' + t('rptab.warningsCount', ws.length);
  // row click
  document.querySelectorAll('#rpBody tr[data-id]').forEach(tr => tr.addEventListener('click', () => {
    select({ kind: tr.dataset.kind, id: tr.dataset.id });
  }));
  highlightTableRow();
}
function highlightTableRow() {
  document.querySelectorAll('#rpBody tr[data-id]').forEach(tr => {
    tr.classList.toggle('sel', state.sel && tr.dataset.kind === state.sel.kind && tr.dataset.id === state.sel.id);
  });
}

/* ============================ file ops ============================ */
async function loadExample() {
  try { const net = await api('/api/example'); loadNetwork(net); fitView(); toast(t('toast.exampleLoaded'), 'ok'); }
  catch (e) { toast(t('err.exampleLoad') + e.message, 'err'); }
}
function loadNetwork(net) {
  // normalize
  net.nodes = net.nodes || []; net.links = net.links || [];
  net.patterns = net.patterns || []; net.curves = net.curves || []; net.controls = net.controls || [];
  net.options = { ...DEFAULT_OPTIONS, ...(net.options || {}) };
  net.times = { ...DEFAULT_TIMES, ...(net.times || {}) };
  net.quality = { type: 'NONE', chemName: 'Chlorine', chemUnits: 'mg/L', traceNode: '', ...(net.quality || {}) };
  net.geo = { ...defaultGeo(), ...(net.geo || {}) };
  net.nodes.forEach(n => { n.vertices = n.vertices || []; });
  net.links.forEach(l => { l.vertices = l.vertices || []; });
  state.net = net; select(null); clearResults(); buildSettings(); renderElemList(); syncMapUI(); render(); autosave();
}
function newNetwork() { loadNetwork(emptyNetwork()); fitView(); toast(t('toast.newNet')); }

$('btnExample').addEventListener('click', loadExample);
$('btnNew').addEventListener('click', () => { if (confirm(t('confirm.new'))) newNetwork(); });
$('btnRun').addEventListener('click', runSim);
$('btnExport').addEventListener('click', async () => {
  try {
    const text = await api('/api/export', 'POST', state.net, false, true);
    download(text, (state.net.title || 'network') + '.inp', 'text/plain');
  } catch (e) { toast(t('err.export') + e.message, 'err'); }
});
$('btnSave').addEventListener('click', () => download(JSON.stringify(state.net, null, 2), (state.net.title || 'network') + '.json', 'application/json'));
$('btnImport').addEventListener('click', () => $('fileInp').click());
$('btnOpen').addEventListener('click', () => $('fileJson').click());
$('fileInp').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const text = await f.text(); const net = await api('/api/import', 'POST', text, true); loadNetwork(net); fitView(); toast(t('toast.imported') + f.name, 'ok'); }
  catch (err) { toast(t('err.import') + err.message, 'err'); }
  e.target.value = '';
});
$('fileJson').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const net = JSON.parse(await f.text()); loadNetwork(net); fitView(); toast(t('toast.opened') + f.name, 'ok'); }
  catch (err) { toast(t('err.open') + err.message, 'err'); }
  e.target.value = '';
});
function download(text, name, mime) {
  const blob = new Blob([text], { type: mime }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================ misc ============================ */
function fmt(v) {
  if (typeof v !== 'number' || isNaN(v)) return '–';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
function clock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let saveTimer = null;
function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem('epanet-web-net', JSON.stringify(state.net)); } catch (e) {} }, 500); }

$('btnZoomIn').addEventListener('click', () => zoomBtn(1.2));
$('btnZoomOut').addEventListener('click', () => zoomBtn(1 / 1.2));
$('btnFit').addEventListener('click', fitView);
function zoomBtn(f) {
  const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2; const [wx, wy] = s2w(cx, cy);
  state.view.scale = Math.max(0.05, state.view.scale * f);
  state.view.panX = cx - wx * state.view.scale; state.view.panY = cy + wy * state.view.scale; render();
}
window.addEventListener('resize', resize);

/* ============================ i18n wiring ============================ */
function updateEngineBadge() {
  const badge = $('engineBadge');
  if (state.engineStatus === 'ok') { badge.textContent = 'EPANET ' + state.engineVersion; badge.className = 'engine-badge ok'; }
  else if (state.engineStatus === 'notready') { badge.textContent = t('engine.notReady'); badge.className = 'engine-badge err'; }
  else if (state.engineStatus === 'connfail') { badge.textContent = t('engine.connFail'); badge.className = 'engine-badge err'; }
  else { badge.textContent = t('engine.checking'); badge.className = 'engine-badge'; }
}
function updateRunButton() {
  const btn = $('btnRun');
  if (btn.disabled) { btn.textContent = t('btn.running'); return; }
  btn.textContent = (state.results && state.stale) ? t('btn.rerun') : t('btn.run');
}
function refreshLangUI() {
  updateEngineBadge(); updateRunButton();
  setTool(state.tool); renderElemList(); buildPropsForm(); buildSettings();
  if (!$('mapPanel').hidden) buildMapPanel();
  updateAttribution();
  if (state.results) {
    renderTables(); renderLegend(); updateTimeUI();
    $('rpSummary').textContent = t('rp.summary', state.results.nodes.length, state.results.links.length, state.results.times.length);
  }
}
$('langSelect').value = LANG;
$('langSelect').addEventListener('change', e => setLang(e.target.value));
document.addEventListener('langchange', () => { $('langSelect').value = LANG; refreshLangUI(); });

/* ============================ init ============================ */
async function init() {
  buildSettings(); renderElemList(); updateRunButton(); syncMapUI();
  try {
    const h = await api('/api/health');
    state.engineVersion = h.version;
    state.engineStatus = h.ready ? 'ok' : 'notready';
  } catch (e) { state.engineStatus = 'connfail'; }
  updateEngineBadge();
  // restore or load example
  let restored = false;
  try { const s = localStorage.getItem('epanet-web-net'); if (s) { loadNetwork(JSON.parse(s)); restored = true; } } catch (e) {}
  resize();
  if (restored) { fitView(); } else { await loadExample(); }
  setTool('select');
  requestAnimationFrame(() => { resize(); fitView(); });
}
init();