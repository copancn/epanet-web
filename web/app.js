'use strict';

/* ============================ state ============================ */
const DEFAULT_OPTIONS = { flowUnits: 'LPS', headLoss: 'H-W', demandMult: 1, trials: 40, accuracy: 0.001, tolerance: 0.01, unbalanced: 10 };
const DEFAULT_TIMES = { duration: 86400, hydStep: 3600, qualStep: 300, patternStep: 3600, patternStart: 0, reportStep: 3600, reportStart: 0, startClock: 0, statistic: 'NONE' };
const DEFAULT_REACTIONS = { bulkOrder: 0, wallOrder: 0, tankOrder: 0, globalBulk: 0, globalWall: 0, limitingPot: 0, roughCorrel: 0 };
const DEFAULT_ENERGY = { globalEfficiency: 0, globalPrice: 0, pricePattern: '', demandCharge: 0 };
const DEFAULT_DEMAND_MODEL = { type: 'DDA', pmin: 0, preq: 20, pexp: 0.5 };

function emptyNetwork() {
  return {
    title: t('net.newTitle'), nodes: [], links: [], patterns: [], curves: [], controls: [], rules: [],
    options: { ...DEFAULT_OPTIONS }, times: { ...DEFAULT_TIMES },
    quality: { type: 'NONE', chemName: 'Chlorine', chemUnits: 'mg/L', traceNode: '' },
    reactions: { ...DEFAULT_REACTIONS }, energy: { ...DEFAULT_ENERGY }, demandModel: { ...DEFAULT_DEMAND_MODEL },
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
  colorByValue: false,
  playing: false,
  stale: false,
  engineStatus: 'checking', engineVersion: 0,
  elemTab: 'nodes',
  mouse: { sx: 0, sy: 0, wx: 0, wy: 0 },
  drag: null,
  hover: null,
  theme: 'light',
  settingsOpen: 'analysis',
  wizard: null,
};

const VALVE_TYPES = ['PRV', 'PSV', 'PBV', 'FCV', 'TCV', 'GPV', 'PCV'];
const PALETTES = {
  light: {
    grid: '#eef2f7',
    node: { JUNCTION: '#334155', RESERVOIR: '#0ea5e9', TANK: '#8b5cf6' },
    link: { PIPE: '#64748b', PUMP: '#db2777', VALVE: '#ea580c' },
    label: '#334155', labelDim: '#64748b',
    sel: '#2563eb', hover: 'rgba(37,99,235,.22)', hoverFill: 'rgba(37,99,235,.12)', selFill: 'rgba(37,99,235,.18)',
    nodeEdge: '#ffffff', symbolFill: '#ffffff', wave: 'rgba(255,255,255,.85)', waveDim: 'rgba(255,255,255,.7)',
    halo: 'rgba(255,255,255,.92)', casing: 'rgba(255,255,255,.85)',
    statusOpen: '#0f9d58', statusClosed: '#b0b8c4',
  },
  dark: {
    grid: 'rgba(148,163,184,.14)',
    node: { JUNCTION: '#cbd5e1', RESERVOIR: '#38bdf8', TANK: '#a78bfa' },
    link: { PIPE: '#94a3b8', PUMP: '#f472b6', VALVE: '#fb923c' },
    label: '#e2e8f0', labelDim: '#94a3b8',
    sel: '#60a5fa', hover: 'rgba(96,165,250,.28)', hoverFill: 'rgba(96,165,250,.16)', selFill: 'rgba(96,165,250,.22)',
    nodeEdge: '#0b1220', symbolFill: '#0b1220', wave: 'rgba(11,18,32,.85)', waveDim: 'rgba(11,18,32,.7)',
    halo: 'rgba(11,18,32,.92)', casing: 'rgba(11,18,32,.85)',
    statusOpen: '#34d399', statusClosed: '#64748b',
  },
};
function pal() { return PALETTES[state.theme] || PALETTES.light; }
function nodeColorBase(type) { const p = pal(); return p.node[type] || p.node.JUNCTION; }
function linkColorBase(t) { const p = pal(); return t === 'PUMP' ? p.link.PUMP : (VALVE_TYPES.includes(t) ? p.link.VALVE : p.link.PIPE); }
function mapOn() { return !!(state.net.geo && state.net.geo.enabled); }

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
  if (!(w > 0) || !(h > 0)) return;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

// The canvas CSS box changes when the result bar / results panel appear or the
// window resizes; keep the backing store in sync or stale pixels + stretching show.
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => resize()).observe(canvas);

function render() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
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
  ctx.strokeStyle = pal().grid; ctx.lineWidth = 1; ctx.beginPath();
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
  // Neutral base so the map-opacity blend never picks up the UI theme background
  // (a dark backdrop would put a dark veil over the tiles in dark mode).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
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
  const hovered = state.hover && state.hover.kind === 'link' && state.hover.id === l.id;
  const rs = state.results ? state.resLink[l.id] : null;
  const heat = !!rs && state.colorByValue;
  let color = linkColorBase(l.type);
  let width = 2.4;
  let closed = l.status === 'CLOSED';
  if (rs) {
    const t = state.timeIndex;
    if (heat) {
      if (state.linkColor === 'status') {
        color = rs.status[t] > 0.5 ? pal().statusOpen : pal().statusClosed;
      } else {
        const r = metricRange(state.results.links, state.linkColor);
        color = colorScale(norm(metricAt(rs, state.linkColor, t), r));
      }
      width = 3;
    }
    closed = rs.status[t] < 0.5;
  }
  const p = pal();
  if (hovered && !selected) { ctx.strokeStyle = p.hover; ctx.lineWidth = width + 6; ctx.lineCap = 'round'; strokePolyline(pts); }
  if (selected) { ctx.strokeStyle = p.sel; ctx.lineWidth = width + 5; ctx.lineCap = 'round'; strokePolyline(pts); }
  // casing under the pipe keeps it legible over busy map imagery
  if (mapOn()) { ctx.strokeStyle = p.casing; ctx.lineWidth = width + 3; ctx.lineCap = 'round'; strokePolyline(pts); }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.setLineDash(closed ? [6, 5] : []);
  strokePolyline(pts);
  ctx.setLineDash([]);

  // flow direction arrow
  if (rs && Math.abs(rs.flow[state.timeIndex]) > 1e-6 && state.linkColor !== 'status') {
    const rev = rs.flow[state.timeIndex] < 0;
    drawArrow(pts, rev, heat ? color : linkColorBase(l.type));
  }
  // pump / valve symbol at midpoint
  const mid = polyMid(pts);
  if (l.type === 'PUMP') drawPumpSymbol(mid, color);
  else if (VALVE_TYPES.includes(l.type)) drawValveSymbol(mid, color);

  // label
  if (state.view.scale > 0.35) {
    ctx.fillStyle = selected ? p.sel : p.labelDim;
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'center';
    haloText(l.id, mid[0], mid[1] - 8);
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
function haloText(text, x, y) {
  if (mapOn()) {
    ctx.save();
    ctx.strokeStyle = pal().halo; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
}
function drawArrow(pts, rev, color) {
  const m = polyMid(pts); let ang = m[2]; if (rev) ang += Math.PI;
  const s = 7;
  ctx.beginPath();
  ctx.moveTo(m[0] + Math.cos(ang) * s, m[1] + Math.sin(ang) * s);
  ctx.lineTo(m[0] + Math.cos(ang + 2.5) * s, m[1] + Math.sin(ang + 2.5) * s);
  ctx.lineTo(m[0] + Math.cos(ang - 2.5) * s, m[1] + Math.sin(ang - 2.5) * s);
  ctx.closePath();
  if (mapOn()) { ctx.strokeStyle = pal().halo; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke(); }
  ctx.fillStyle = color; ctx.fill();
}
function drawPumpSymbol(m, color) {
  ctx.fillStyle = pal().symbolFill; ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(m[0], m[1], 7, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(m[0] - 3, m[1] - 4); ctx.lineTo(m[0] + 5, m[1]); ctx.lineTo(m[0] - 3, m[1] + 4); ctx.closePath(); ctx.fill();
}
function drawValveSymbol(m, color) {
  ctx.fillStyle = pal().symbolFill; ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m[0] - 6, m[1] - 5); ctx.lineTo(m[0] - 6, m[1] + 5); ctx.lineTo(m[0] + 6, m[1] - 5); ctx.lineTo(m[0] + 6, m[1] + 5); ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function drawNode(n) {
  const [sx, sy] = w2s(n.x, n.y);
  const selected = state.sel && state.sel.kind === 'node' && state.sel.id === n.id;
  const hovered = state.hover && state.hover.kind === 'node' && state.hover.id === n.id;
  const rs = state.results ? state.resNode[n.id] : null;
  const p = pal();
  let fill = nodeColorBase(n.type);
  if (rs && state.colorByValue) {
    const r = metricRange(state.results.nodes, state.nodeColor);
    fill = colorScale(norm(metricAt(rs, state.nodeColor, state.timeIndex), r));
  }
  if (hovered && !selected) {
    ctx.fillStyle = p.hoverFill;
    ctx.beginPath(); ctx.arc(sx, sy, 14, 0, 7); ctx.fill();
  }
  if (selected) {
    ctx.fillStyle = p.selFill;
    ctx.beginPath(); ctx.arc(sx, sy, 15, 0, 7); ctx.fill();
    ctx.strokeStyle = p.sel; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 13, 0, 7); ctx.stroke();
  }
  // backing disc separates the symbol from map imagery
  if (mapOn()) { ctx.fillStyle = p.halo; ctx.beginPath(); ctx.arc(sx, sy, 12, 0, 7); ctx.fill(); }
  ctx.lineWidth = 1.5; ctx.strokeStyle = p.nodeEdge;
  if (n.type === 'RESERVOIR') {
    ctx.fillStyle = fill; roundRect(sx - 9, sy - 7, 18, 14, 3); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = p.wave; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(sx - 6, sy - 1); ctx.quadraticCurveTo(sx - 3, sy - 4, sx, sy - 1); ctx.quadraticCurveTo(sx + 3, sy + 2, sx + 6, sy - 1); ctx.stroke();
  } else if (n.type === 'TANK') {
    ctx.fillStyle = fill; roundRect(sx - 7, sy - 9, 14, 18, 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = p.waveDim; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx - 7, sy - 3); ctx.lineTo(sx + 7, sy - 3); ctx.stroke();
  } else {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, 7); ctx.fill(); ctx.stroke();
  }
  if (state.view.scale > 0.3) {
    ctx.fillStyle = selected ? p.sel : p.label;
    ctx.font = (selected ? 'bold ' : '') + '11px Consolas, monospace';
    ctx.textAlign = 'center';
    haloText(n.id, sx, sy + 20);
    if (rs) {
      const v = metricAt(rs, state.nodeColor, state.timeIndex);
      ctx.fillStyle = p.labelDim; ctx.font = '9px Consolas, monospace';
      haloText(fmt(v), sx, sy + 31);
    }
  }
}

function drawDraft() {
  const a = nodeById(state.draft.from); if (!a) return;
  const [ax, ay] = w2s(a.x, a.y);
  const [bx, by] = w2s(state.draft.wx, state.draft.wy);
  ctx.strokeStyle = pal().sel; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
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
function metricAt(rs, key, ti) { const a = rs && rs[key]; return a ? a[ti] : NaN; }
const _rangeCache = {};
function metricRange(series, key) {
  const ck = key + ':' + series.length + ':' + (series[0] && series[0][key] ? series[0][key].length : 0);
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
    setHover(state.draft ? null : h, sx, sy);
    return;
  }
  setHover(null);
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

canvas.addEventListener('mouseleave', () => setHover(null));

function setHover(hit, sx, sy) {
  const prev = state.hover;
  const changed = (prev && hit) ? (prev.kind !== hit.kind || prev.id !== hit.id) : (!!prev !== !!hit);
  state.hover = hit;
  if (changed) render();
  updateTip(hit, sx, sy);
}

function updateTip(hit, sx, sy) {
  const tip = $('canvasTip');
  if (!hit || state.drag || state.draft) { tip.hidden = true; return; }
  const html = tipContent(hit);
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html;
  tip.hidden = false;
  const wrap = canvas.parentElement;
  const pad = 14;
  let x = sx + pad, y = sy + pad;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  if (x + tw > wrap.clientWidth - 8) x = sx - tw - pad;
  if (y + th > wrap.clientHeight - 8) y = sy - th - pad;
  tip.style.left = Math.max(4, x) + 'px';
  tip.style.top = Math.max(4, y) + 'px';
}

function tipContent(hit) {
  const obj = hit.kind === 'node' ? nodeById(hit.id) : linkById(hit.id);
  if (!obj) return '';
  const head = `<div class="tip-head"><span class="tip-id">${esc(obj.id)}</span><span class="tip-type">${esc(obj.type)}</span></div>`;
  const rows = [];
  if (state.results) {
    const ti = state.timeIndex, u = state.results.units;
    const rs = hit.kind === 'node' ? state.resNode[hit.id] : state.resLink[hit.id];
    if (rs) {
      if (hit.kind === 'node') {
        rows.push([t('m.pressure'), fmt(rs.pressure[ti]), u.pressure]);
        rows.push([t('m.head'), fmt(rs.head[ti]), u.head]);
        rows.push([t('m.demand'), fmt(rs.demand[ti]), u.flow]);
        if (rs.level) rows.push([t('m.level'), fmt(rs.level[ti]), u.head]);
        if (rs.volume) rows.push([t('m.volume'), fmt(rs.volume[ti]), 'm³']);
        if (rs.demandDeficit && rs.demandDeficit[ti] > 0) rows.push([t('m.deficit'), fmt(rs.demandDeficit[ti]), u.flow]);
        if (u.quality) rows.push([t('m.quality'), fmt(rs.quality[ti]), u.quality]);
      } else {
        rows.push([t('m.flow'), fmt(rs.flow[ti]), u.flow]);
        rows.push([t('m.velocity'), fmt(rs.velocity[ti]), u.velocity]);
        rows.push([t('m.headloss'), fmt(rs.headloss[ti]), u.headloss]);
        rows.push([t('m.status'), rs.status[ti] > 0.5 ? t('status.open') : t('status.closed'), '']);
        if (rs.energy) rows.push([t('m.energy'), fmt(rs.energy[ti]), 'kWh']);
        if (rs.efficiency) rows.push([t('m.efficiency'), fmt(rs.efficiency[ti]), '%']);
        if (rs.setting && rs.type !== 'PUMP') rows.push([t('m.setting'), fmt(rs.setting[ti]), '']);
      }
    }
  } else if (hit.kind === 'node') {
    rows.push([t('prop.elev'), fmt(obj.elevation), 'm']);
    if (obj.type === 'JUNCTION') rows.push([t('prop.baseDemand'), fmt(obj.demand), '']);
  } else {
    rows.push([t('th.fromTo'), esc(obj.from) + '→' + esc(obj.to), '']);
    rows.push([t('prop.length'), fmt(obj.length), 'm']);
  }
  if (!rows.length) return head;
  return head + rows.map(([k, v, un]) => `<div class="tip-row"><span>${esc(k)}</span><span>${v}${un ? ' ' + esc(un) : ''}</span></div>`).join('');
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
  if (state.wizard) { wizardMarkTouched(); return; }
  if (state.results) {
    if (structural) { clearResults(); }
    else { state.stale = true; updateRunButton(); }
  }
  autosave();
  recordHistory(structural);
}

/* ============================ undo / redo ============================ */
// Snapshot history: each edit burst pushes the pre-edit network snapshot.
// Rapid non-structural edits (drag, typing) coalesce into one step.
const HIST_MAX = 60, HIST_COALESCE_MS = 600;
const histUndo = [], histRedo = [];
let histBaseline = null, histLast = 0;
function cloneNet() { return JSON.parse(JSON.stringify(state.net)); }
function resetHistory() { histUndo.length = 0; histRedo.length = 0; histBaseline = cloneNet(); histLast = 0; updateHistoryUI(); }
function recordHistory(force) {
  if (histBaseline === null) { histBaseline = cloneNet(); return; }
  const now = Date.now();
  if (!force && now - histLast < HIST_COALESCE_MS) { histLast = now; return; }
  histUndo.push(histBaseline);
  if (histUndo.length > HIST_MAX) histUndo.shift();
  histRedo.length = 0;
  histBaseline = cloneNet();
  histLast = now;
  updateHistoryUI();
}
function restoreNet(snap) {
  state.net = snap; state.sel = null; state.draft = null;
  clearResults();
  renderElemList(); buildPropsForm(); buildSettings(); syncMapUI(); render();
  autosave();
}
function undo() {
  if (!histUndo.length) return;
  histRedo.push(cloneNet());
  restoreNet(histUndo.pop());
  histBaseline = cloneNet(); histLast = 0;
  updateHistoryUI();
}
function redo() {
  if (!histRedo.length) return;
  histUndo.push(cloneNet());
  restoreNet(histRedo.pop());
  histBaseline = cloneNet(); histLast = 0;
  updateHistoryUI();
}
function updateHistoryUI() {
  $('btnUndo').disabled = !histUndo.length;
  $('btnRedo').disabled = !histRedo.length;
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
    const color = kind === 'node' ? nodeColorBase(it.type) : linkColorBase(it.type);
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
function checkInput(val, onch) {
  const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!val;
  i.addEventListener('change', () => onch(i.checked)); return i;
}
function checkRow(label, val, onch) {
  const l = document.createElement('label'); l.className = 'check-row';
  l.appendChild(checkInput(val, onch)); l.appendChild(document.createTextNode(label)); return l;
}
function sourceFields(obj) {
  const wrap = document.createElement('div');
  wrap.appendChild(sectionTitle(t('prop.source')));
  wrap.appendChild(field(t('prop.sourceType'), selectInput(obj.sourceType || '', [['', t('opt.none')], ['CONCEN', t('src.concen')], ['MASS', t('src.mass')], ['SETPOINT', t('src.setpoint')], ['FLOWPACED', t('src.flowpaced')]], v => { obj.sourceType = v; markDirty(false); })));
  const r = document.createElement('div'); r.className = 'field-row';
  r.appendChild(field(t('prop.sourceQual'), numInput(obj.sourceQual, v => { obj.sourceQual = v; markDirty(false); })));
  r.appendChild(field(t('prop.sourcePat'), selectInput(obj.sourcePattern, patternOptions(), v => { obj.sourcePattern = v; markDirty(false); })));
  wrap.appendChild(r);
  return wrap;
}
function tagCommentFields(obj) {
  const wrap = document.createElement('div');
  wrap.appendChild(field(t('prop.tag'), textInput(obj.tag, v => { obj.tag = v; markDirty(false); })));
  wrap.appendChild(field(t('prop.comment'), textInput(obj.comment, v => { obj.comment = v; markDirty(false); })));
  return wrap;
}
function demandsEditor(obj) {
  const wrap = document.createElement('div');
  wrap.appendChild(sectionTitle(t('prop.demands')));
  const list = document.createElement('div'); wrap.appendChild(list);
  function rebuild() {
    list.innerHTML = '';
    (obj.demands || []).forEach((d, idx) => {
      const card = document.createElement('div'); card.className = 'demand-card';
      const r1 = document.createElement('div'); r1.className = 'field-row';
      r1.appendChild(field(t('prop.demandBase'), numInput(d.base, v => { d.base = v; markDirty(false); })));
      r1.appendChild(field(t('prop.demandPat'), selectInput(d.pattern, patternOptions(), v => { d.pattern = v; markDirty(false); })));
      card.appendChild(r1);
      const r2 = document.createElement('div'); r2.className = 'field-row';
      r2.appendChild(field(t('prop.demandName'), textInput(d.name, v => { d.name = v; markDirty(false); })));
      const del = document.createElement('button'); del.className = 'dc-del'; del.textContent = '✕'; del.title = t('prop.delete');
      del.addEventListener('click', () => { obj.demands.splice(idx, 1); markDirty(false); rebuild(); });
      const delWrap = document.createElement('div'); delWrap.className = 'field'; delWrap.style.alignSelf = 'flex-end'; delWrap.appendChild(del);
      r2.appendChild(delWrap);
      card.appendChild(r2);
      list.appendChild(card);
    });
  }
  rebuild();
  wrap.appendChild(btnSm(t('prop.addDemand'), () => { obj.demands = obj.demands || []; obj.demands.push({ base: 0, pattern: '', name: '' }); markDirty(false); rebuild(); }));
  return wrap;
}

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
      form.appendChild(field(t('prop.emitter'), numInput(obj.emitter, v => { obj.emitter = v; markDirty(false); })));
      form.appendChild(demandsEditor(obj));
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
      const rm = document.createElement('div'); rm.className = 'field-row';
      rm.appendChild(field(t('prop.mixModel'), selectInput(obj.mixModel || '', [['', t('order.default')], ['MIX1', t('mix.mix1')], ['MIX2', t('mix.mix2')], ['FIFO', t('mix.fifo')], ['LIFO', t('mix.lifo')]], v => { obj.mixModel = v; markDirty(false); })));
      rm.appendChild(field(t('prop.mixFraction'), numInput(obj.mixFraction, v => { obj.mixFraction = v; markDirty(false); }, '0.05')));
      form.appendChild(rm);
      form.appendChild(field(t('prop.tankKBulk'), numInput(obj.tankKBulk, v => { obj.tankKBulk = v; markDirty(false); }, '0.01')));
      form.appendChild(checkRow(t('prop.canOverflow'), obj.canOverflow, v => { obj.canOverflow = v; markDirty(false); }));
    }
    if (obj.type === 'JUNCTION' || obj.type === 'TANK') form.appendChild(demButton('sel'));
    form.appendChild(field(t('prop.initQual'), numInput(obj.initQual, v => { obj.initQual = v; markDirty(false); })));
    form.appendChild(sourceFields(obj));
    form.appendChild(tagCommentFields(obj));
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
      const rk = document.createElement('div'); rk.className = 'field-row';
      rk.appendChild(field(t('prop.kBulk'), numInput(obj.kBulk, v => { obj.kBulk = v; markDirty(false); }, '0.01')));
      rk.appendChild(field(t('prop.kWall'), numInput(obj.kWall, v => { obj.kWall = v; markDirty(false); }, '0.01')));
      form.appendChild(rk);
      const rlk = document.createElement('div'); rlk.className = 'field-row';
      rlk.appendChild(field(t('prop.leakArea'), numInput(obj.leakArea, v => { obj.leakArea = v; markDirty(false); })));
      rlk.appendChild(field(t('prop.leakExpan'), numInput(obj.leakExpan, v => { obj.leakExpan = v; markDirty(false); }, '0.05')));
      form.appendChild(rlk);
    } else if (obj.type === 'PUMP') {
      form.appendChild(field(t('prop.headCurve'), selectInput(obj.headCurve, curveOptions(), v => { obj.headCurve = v; markDirty(false); })));
      form.appendChild(field(t('prop.power'), numInput(obj.power, v => { obj.power = v; markDirty(false); })));
      form.appendChild(field(t('prop.speed'), numInput(obj.speed, v => { obj.speed = v; markDirty(false); }, '0.1')));
      form.appendChild(field(t('prop.speedPat'), selectInput(obj.speedPattern, patternOptions(), v => { obj.speedPattern = v; markDirty(false); })));
      form.appendChild(field(t('prop.effCurve'), selectInput(obj.effCurve, curveOptions(), v => { obj.effCurve = v; markDirty(false); })));
      const rp = document.createElement('div'); rp.className = 'field-row';
      rp.appendChild(field(t('prop.price'), numInput(obj.price, v => { obj.price = v; markDirty(false); }, '0.01')));
      rp.appendChild(field(t('prop.pricePat'), selectInput(obj.pricePattern, patternOptions(), v => { obj.pricePattern = v; markDirty(false); })));
      form.appendChild(rp);
    } else {
      form.appendChild(field(t('prop.valveType'), selectInput(obj.type, VALVE_TYPES, v => { obj.type = v; markDirty(false); buildPropsForm(); render(); })));
      form.appendChild(field(t('prop.diamMm'), numInput(obj.diameter, v => { obj.diameter = v; markDirty(false); })));
      if (obj.type === 'GPV') form.appendChild(field(t('prop.hlossCurve'), selectInput(obj.headCurve, curveOptions(), v => { obj.headCurve = v; markDirty(false); })));
      else {
        form.appendChild(field(t('prop.setting'), numInput(obj.setting, v => { obj.setting = v; markDirty(false); })));
        if (obj.type === 'PCV') form.appendChild(field(t('prop.hlossCurve'), selectInput(obj.headCurve, curveOptions(), v => { obj.headCurve = v; markDirty(false); })));
      }
      form.appendChild(field(t('prop.minorLoss'), numInput(obj.minorLoss, v => { obj.minorLoss = v; markDirty(false); })));
    }
    form.appendChild(tagCommentFields(obj));
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
  if (isNode) {
    if (rs.level) rows.push([t('m.level'), rs.level[ti], u.head]);
    if (rs.volume) rows.push([t('m.volume'), rs.volume[ti], 'm³']);
    if (rs.demandDeficit) rows.push([t('m.deficit'), rs.demandDeficit[ti], u.flow]);
    if (u.quality) rows.push([t('m.quality'), rs.quality[ti], u.quality]);
  } else {
    if (rs.setting && rs.type !== 'PUMP') rows.push([t('m.setting'), rs.setting[ti], '']);
    if (rs.power) rows.push([t('m.power'), rs.power[ti], 'kW']);
    if (rs.efficiency) rows.push([t('m.efficiency'), rs.efficiency[ti], '%']);
    if (rs.energy) rows.push([t('m.energy'), rs.energy[ti], 'kWh']);
  }
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
/* ============================ settings: categories ============================ */
function settingsCtx() {
  return { o: state.net.options, tm: state.net.times, q: state.net.quality, dm: state.net.demandModel, rx: state.net.reactions, en: state.net.energy };
}
const SETTINGS_CATEGORIES = [
  { key: 'analysis', label: 'set.analysis', build(p) {
    const { o } = settingsCtx();
    p.appendChild(field(t('set.flowUnits'), selectInput(o.flowUnits, [['LPS', t('unit.lps')], ['LPM', t('unit.lpm')], ['CMH', t('unit.cmh')], ['CMD', t('unit.cmd')], ['CMS', t('unit.cms')], ['MLD', t('unit.mld')], ['GPM', t('unit.gpm')], ['CFS', t('unit.cfs')], ['MGD', t('unit.mgd')]], v => { o.flowUnits = v; markDirty(false); })));
    p.appendChild(field(t('set.headLoss'), selectInput(o.headLoss, [['H-W', 'Hazen-Williams'], ['D-W', 'Darcy-Weisbach'], ['C-M', 'Chezy-Manning']], v => { o.headLoss = v; markDirty(false); })));
    p.appendChild(field(t('set.demandMult'), numInput(o.demandMult, v => { o.demandMult = v; markDirty(false); }, '0.1')));
    const r = document.createElement('div'); r.className = 'field-row';
    r.appendChild(field(t('set.trials'), numInput(o.trials, v => { o.trials = v; markDirty(false); }, '1')));
    r.appendChild(field(t('set.accuracy'), numInput(o.accuracy, v => { o.accuracy = v; markDirty(false); }, '0.0001')));
    p.appendChild(r);
  } },
  { key: 'time', label: 'set.time', build(p) {
    const { tm } = settingsCtx();
    p.appendChild(field(t('set.duration'), numInput(tm.duration / 3600, v => { tm.duration = Math.round(v * 3600); markDirty(false); }, '1')));
    const r2 = document.createElement('div'); r2.className = 'field-row';
    r2.appendChild(field(t('set.hydStep'), numInput(tm.hydStep / 3600, v => { tm.hydStep = Math.max(1, Math.round(v * 3600)); markDirty(false); }, '0.5')));
    r2.appendChild(field(t('set.reportStep'), numInput(tm.reportStep / 3600, v => { tm.reportStep = Math.max(1, Math.round(v * 3600)); markDirty(false); }, '0.5')));
    p.appendChild(r2);
    const r3 = document.createElement('div'); r3.className = 'field-row';
    r3.appendChild(field(t('set.patternStep'), numInput(tm.patternStep / 3600, v => { tm.patternStep = Math.max(1, Math.round(v * 3600)); markDirty(false); }, '0.5')));
    const sc = document.createElement('input'); sc.type = 'time'; sc.value = secToClock(tm.startClock);
    sc.addEventListener('change', () => { tm.startClock = clockToSec(sc.value); markDirty(false); });
    r3.appendChild(field(t('set.startClock'), sc));
    p.appendChild(r3);
    const r4 = document.createElement('div'); r4.className = 'field-row';
    r4.appendChild(field(t('set.qualStep'), numInput(tm.qualStep / 3600, v => { tm.qualStep = Math.max(1, Math.round(v * 3600)); markDirty(false); }, 'any')));
    r4.appendChild(field(t('set.ruleStep'), numInput((tm.ruleStep || 0) / 3600, v => { tm.ruleStep = Math.max(0, Math.round(v * 3600)); markDirty(false); }, 'any')));
    p.appendChild(r4);
    p.appendChild(field(t('set.statistic'), selectInput(tm.statistic, [['NONE', t('stat.series')], ['AVERAGED', t('stat.avg')], ['MINIMUM', t('stat.min')], ['MAXIMUM', t('stat.max')], ['RANGE', t('stat.range')]], v => { tm.statistic = v; markDirty(false); })));
  } },
  { key: 'quality', label: 'set.quality', build(p) {
    const { q } = settingsCtx();
    p.appendChild(field(t('set.qualType'), selectInput(q.type, [['NONE', t('qual.none')], ['CHEM', t('qual.chem')], ['AGE', t('qual.age')], ['TRACE', t('qual.trace')]], v => { q.type = v; markDirty(false); refreshSettingsUI(); })));
    if (q.type === 'CHEM') {
      const rq = document.createElement('div'); rq.className = 'field-row';
      rq.appendChild(field(t('set.chemName'), textInput(q.chemName, v => { q.chemName = v; markDirty(false); })));
      const cuOpts = [...new Set([q.chemUnits, 'mg/L', 'ug/L', 'g/L'])].filter(Boolean).map(u => [u, u]);
      rq.appendChild(field(t('set.chemUnits'), selectInput(q.chemUnits, cuOpts, v => { q.chemUnits = v; markDirty(false); })));
      p.appendChild(rq);
    } else if (q.type === 'TRACE') {
      p.appendChild(field(t('set.traceNode'), selectInput(q.traceNode, [['', t('opt.select')], ...nodeOptions()], v => { q.traceNode = v; markDirty(false); })));
    }
  } },
  { key: 'demand', label: 'set.demandModel', build(p) {
    const { dm } = settingsCtx();
    p.appendChild(field(t('set.demandModel'), selectInput(dm.type || 'DDA', [['DDA', t('set.dda')], ['PDA', t('set.pda')]], v => { dm.type = v; markDirty(false); refreshSettingsUI(); })));
    if ((dm.type || 'DDA') === 'PDA') {
      const rd = document.createElement('div'); rd.className = 'field-row';
      rd.appendChild(field(t('set.pmin'), numInput(dm.pmin, v => { dm.pmin = v; markDirty(false); })));
      rd.appendChild(field(t('set.preq'), numInput(dm.preq, v => { dm.preq = v; markDirty(false); })));
      p.appendChild(rd);
      p.appendChild(field(t('set.pexp'), numInput(dm.pexp, v => { dm.pexp = v; markDirty(false); }, '0.1')));
    }
  } },
  { key: 'reactions', label: 'set.reactions', build(p) {
    const { rx } = settingsCtx();
    const orderOpts = [[0, t('order.default')], [1, '1'], [2, '2']];
    const ro = document.createElement('div'); ro.className = 'field-row';
    ro.appendChild(field(t('set.bulkOrder'), selectInput(rx.bulkOrder || 0, orderOpts, v => { rx.bulkOrder = parseInt(v, 10); markDirty(false); })));
    ro.appendChild(field(t('set.wallOrder'), selectInput(rx.wallOrder || 0, orderOpts, v => { rx.wallOrder = parseInt(v, 10); markDirty(false); })));
    p.appendChild(ro);
    p.appendChild(field(t('set.tankOrder'), selectInput(rx.tankOrder || 0, orderOpts, v => { rx.tankOrder = parseInt(v, 10); markDirty(false); })));
    const rg = document.createElement('div'); rg.className = 'field-row';
    rg.appendChild(field(t('set.globalBulk'), numInput(rx.globalBulk, v => { rx.globalBulk = v; markDirty(false); }, '0.01')));
    rg.appendChild(field(t('set.globalWall'), numInput(rx.globalWall, v => { rx.globalWall = v; markDirty(false); }, '0.01')));
    p.appendChild(rg);
    const rl = document.createElement('div'); rl.className = 'field-row';
    rl.appendChild(field(t('set.limitingPot'), numInput(rx.limitingPot, v => { rx.limitingPot = v; markDirty(false); })));
    rl.appendChild(field(t('set.roughCorrel'), numInput(rx.roughCorrel, v => { rx.roughCorrel = v; markDirty(false); }, '0.01')));
    p.appendChild(rl);
  } },
  { key: 'energy', label: 'set.energy', build(p) {
    const { en } = settingsCtx();
    const re = document.createElement('div'); re.className = 'field-row';
    re.appendChild(field(t('set.globalEffic'), numInput(en.globalEfficiency, v => { en.globalEfficiency = v; markDirty(false); }, '1')));
    re.appendChild(field(t('set.globalPrice'), numInput(en.globalPrice, v => { en.globalPrice = v; markDirty(false); }, '0.01')));
    p.appendChild(re);
    const re2 = document.createElement('div'); re2.className = 'field-row';
    re2.appendChild(field(t('set.pricePattern'), selectInput(en.pricePattern, patternOptions(), v => { en.pricePattern = v; markDirty(false); })));
    re2.appendChild(field(t('set.demandCharge'), numInput(en.demandCharge, v => { en.demandCharge = v; markDirty(false); }, '0.01')));
    p.appendChild(re2);
  } },
  { key: 'advanced', label: 'set.advanced', build(p) {
    const { o } = settingsCtx();
    p.appendChild(field(t('set.pressureUnits'), selectInput(o.pressureUnits || '', [['', t('order.default')], ['PSI', 'PSI'], ['KPA', 'kPa'], ['METERS', 'm'], ['BAR', 'bar'], ['FEET', 'ft']], v => { o.pressureUnits = v; markDirty(false); })));
    const ra = document.createElement('div'); ra.className = 'field-row';
    ra.appendChild(field(t('set.specificGravity'), numInput(o.specificGravity, v => { o.specificGravity = v; markDirty(false); }, '0.01')));
    ra.appendChild(field(t('set.viscosity'), numInput(o.viscosity, v => { o.viscosity = v; markDirty(false); }, '0.01')));
    p.appendChild(ra);
    const ra2 = document.createElement('div'); ra2.className = 'field-row';
    ra2.appendChild(field(t('set.diffusivity'), numInput(o.diffusivity, v => { o.diffusivity = v; markDirty(false); }, '0.01')));
    ra2.appendChild(field(t('set.emitterExponent'), numInput(o.emitterExponent, v => { o.emitterExponent = v; markDirty(false); }, '0.01')));
    p.appendChild(ra2);
    p.appendChild(field(t('set.defaultPattern'), selectInput(o.defaultPattern, patternOptions(), v => { o.defaultPattern = v; markDirty(false); })));
    const rb = document.createElement('label'); rb.className = 'check-row';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!o.emitterBackflow;
    cb.addEventListener('change', () => { o.emitterBackflow = cb.checked; markDirty(false); });
    rb.appendChild(cb); rb.appendChild(document.createTextNode(t('set.emitterBackflow'))); p.appendChild(rb);
    const ra3 = document.createElement('div'); ra3.className = 'field-row';
    ra3.appendChild(field(t('set.checkFreq'), numInput(o.checkFreq, v => { o.checkFreq = Math.round(v); markDirty(false); }, '1')));
    ra3.appendChild(field(t('set.maxCheck'), numInput(o.maxCheck, v => { o.maxCheck = Math.round(v); markDirty(false); }, '1')));
    p.appendChild(ra3);
    const ra4 = document.createElement('div'); ra4.className = 'field-row';
    ra4.appendChild(field(t('set.dampLimit'), numInput(o.dampLimit, v => { o.dampLimit = v; markDirty(false); }, '0.001')));
    ra4.appendChild(field(t('set.headError'), numInput(o.headError, v => { o.headError = v; markDirty(false); }, '0.001')));
    p.appendChild(ra4);
    p.appendChild(field(t('set.flowChange'), numInput(o.flowChange, v => { o.flowChange = v; markDirty(false); }, '0.001')));
  } },
];
function categoryByKey(k) { return SETTINGS_CATEGORIES.find(c => c.key === k); }
function refreshSettingsUI() { if (state.wizard) renderWizardBody(); else buildSettings(); }

function buildSettings() {
  const p = $('settingsPanel'); p.innerHTML = '';
  p.appendChild(field(t('set.title'), textInput(state.net.title, v => { state.net.title = v; autosave(); })));
  const wz = document.createElement('button'); wz.className = 'btn btn-sm set-wizard-btn'; wz.textContent = t('set.wizard');
  wz.addEventListener('click', () => openWizard('edit')); p.appendChild(wz);
  SETTINGS_CATEGORIES.forEach(c => {
    const open = state.settingsOpen === c.key;
    const item = document.createElement('div'); item.className = 'acc-item' + (open ? ' open' : '');
    const head = document.createElement('button'); head.type = 'button'; head.className = 'acc-head';
    head.innerHTML = `<span>${esc(t(c.label))}</span><span class="acc-chev">▾</span>`;
    head.addEventListener('click', () => { state.settingsOpen = open ? null : c.key; buildSettings(); });
    item.appendChild(head);
    const body = document.createElement('div'); body.className = 'acc-body';
    if (open) c.build(body);
    item.appendChild(body);
    p.appendChild(item);
  });
}

/* ============================ new-project / settings wizard ============================ */
let wizardBackup = null;
function openWizard(mode) {
  wizardBackup = mode === 'new' ? state.net : JSON.parse(JSON.stringify(state.net));
  if (mode === 'new') state.net = emptyNetwork();
  state.wizard = { mode, step: 0, touched: new Set() };
  $('wizardModal').hidden = false;
  renderWizard();
}
function closeWizard(apply) {
  const w = state.wizard; if (!w) return;
  const mode = w.mode;
  state.wizard = null; $('wizardModal').hidden = true;
  if (apply) {
    if (mode === 'new') { loadNetwork(state.net); fitView(); toast(t('toast.newNet')); }
    else { autosave(); buildSettings(); renderElemList(); render(); toast(t('toast.settingsApplied')); }
  } else {
    state.net = wizardBackup;
    buildSettings(); renderElemList(); render();
  }
  wizardBackup = null;
}
function renderWizardStages() {
  const w = state.wizard; if (!w) return;
  const bar = $('wizardStages'); bar.innerHTML = '';
  SETTINGS_CATEGORIES.forEach((c, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'wiz-stage' + (i === w.step ? ' cur' : '') + (w.touched.has(c.key) ? ' done' : '');
    b.innerHTML = `<span class="ws-idx">${i + 1}</span><span>${esc(t(c.label))}</span>` + (w.touched.has(c.key) ? '<span class="ws-check">✓</span>' : '');
    b.addEventListener('click', () => { w.step = i; renderWizard(); });
    bar.appendChild(b);
  });
}
function renderWizardBody() {
  const w = state.wizard; if (!w) return;
  const body = $('wizardBody'); body.innerHTML = '';
  body.appendChild(field(t('set.title'), textInput(state.net.title, v => { state.net.title = v; })));
  const c = SETTINGS_CATEGORIES[w.step];
  body.appendChild(sectionTitle(t(c.label)));
  const box = document.createElement('div'); c.build(box); body.appendChild(box);
  $('wizardStepLabel').textContent = t('wiz.step', w.step + 1, SETTINGS_CATEGORIES.length, t(c.label));
}
function renderWizard() {
  const w = state.wizard; if (!w) return;
  $('wizardTitle').textContent = t(w.mode === 'new' ? 'wiz.title.new' : 'wiz.title.edit');
  renderWizardStages(); renderWizardBody();
  const last = w.step === SETTINGS_CATEGORIES.length - 1;
  $('btnWizPrev').disabled = w.step === 0;
  $('btnWizNext').textContent = last ? t(w.mode === 'new' ? 'wiz.finish' : 'wiz.apply') : t('wiz.next');
}
function wizardMarkTouched() {
  const w = state.wizard; if (!w) return;
  const c = SETTINGS_CATEGORIES[w.step]; if (c) w.touched.add(c.key);
  renderWizardStages();
}
$('btnWizPrev').addEventListener('click', () => { const w = state.wizard; if (w && w.step > 0) { w.step--; renderWizard(); } });
$('btnWizSkip').addEventListener('click', () => { const w = state.wizard; if (!w) return; if (w.step < SETTINGS_CATEGORIES.length - 1) { w.step++; renderWizard(); } else closeWizard(true); });
$('btnWizNext').addEventListener('click', () => { const w = state.wizard; if (!w) return; wizardMarkTouched(); if (w.step < SETTINGS_CATEGORIES.length - 1) { w.step++; renderWizard(); } else closeWizard(true); });
$('btnCloseWizard').addEventListener('click', () => closeWizard(false));
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
  p.appendChild(demButton('all'));
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

/* ============================ graphical data editors ============================ */
const CURVE_TYPES = ['PUMP', 'EFFICIENCY', 'VOLUME', 'HEADLOSS', 'VALVE', 'GENERIC'];
const dataEditors = [];
function btnSm(label, fn) { const b = document.createElement('button'); b.className = 'btn btn-sm'; b.textContent = label; b.addEventListener('click', fn); return b; }
function linkOptions() { return state.net.links.map(l => [l.id, l.id]); }
function secToClock(sec) { const h = Math.floor(sec / 3600) % 24, m = Math.floor((sec % 3600) / 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
function clockToSec(s) { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 3600 + (m || 0) * 60; }
function redrawEditors() { dataEditors.forEach(cv => { if (cv._redraw) cv._redraw(); }); }
window.addEventListener('resize', () => { if (!$('dataModal').hidden) redrawEditors(); });
function edCanvas(height) { const cv = document.createElement('canvas'); cv.className = 'ed-canvas'; cv.style.height = height + 'px'; dataEditors.push(cv); return cv; }
function edSetup(cv) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 600, H = cv.clientHeight || 120;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  return { c, W, H };
}
function presetValues(kind, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const hour = i * (24 / n);
    if (kind === 'const') out.push(1);
    else if (kind === 'diurnal') out.push(Math.round((0.7 + 0.5 * Math.exp(-Math.pow(hour - 8, 2) / 8) + 0.4 * Math.exp(-Math.pow(hour - 19, 2) / 8)) * 100) / 100);
    else out.push(hour < 6 ? 0.4 : 1.2);
  }
  return out;
}
function barEditor(initial) {
  const cv = edCanvas(120);
  let vals = (initial || []).slice(); if (!vals.length) vals = [1];
  let top = Math.max(3, Math.ceil(Math.max(...vals)));
  const PL = 30, PR = 8, PT = 14, PB = 18; let drag = -1, hover = -1;
  function draw() {
    const { c, W, H } = edSetup(cv); const p = pal();
    const pw = W - PL - PR, ph = H - PT - PB, n = vals.length, bw = pw / n;
    const Y = v => PT + ph - (v / top) * ph;
    c.font = '10px system-ui, sans-serif'; c.lineWidth = 1;
    for (let g = 0; g <= top; g++) { const y = Y(g); c.strokeStyle = p.grid; c.beginPath(); c.moveTo(PL, y); c.lineTo(W - PR, y); c.stroke(); c.fillStyle = p.labelDim; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(String(g), PL - 4, y); }
    vals.forEach((v, i) => {
      const x = PL + i * bw, y = Y(v), active = (i === drag || i === hover);
      c.fillStyle = active ? p.sel : p.link.PIPE; c.globalAlpha = active ? 0.95 : 0.7;
      c.fillRect(x + 1, y, Math.max(1, bw - 2), PT + ph - y); c.globalAlpha = 1;
      if (active) { c.fillStyle = p.label; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(v.toFixed(2), x + bw / 2, y - 2); }
    });
    c.fillStyle = p.labelDim; c.textAlign = 'center'; c.textBaseline = 'top';
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) c.fillText(String(i), PL + i * bw + bw / 2, H - PB + 4);
  }
  const idxAt = sx => { const pw = cv.clientWidth - PL - PR; const i = Math.floor((sx - PL) / (pw / vals.length)); return (i >= 0 && i < vals.length) ? i : -1; };
  const valAt = sy => { const ph = cv.clientHeight - PT - PB; return Math.round(Math.max(0, Math.min(top, (PT + ph - sy) / ph * top)) * 100) / 100; };
  cv.addEventListener('pointerdown', e => { const r = cv.getBoundingClientRect(); drag = idxAt(e.clientX - r.left); if (drag >= 0) { try { cv.setPointerCapture(e.pointerId); } catch (_) {} vals[drag] = valAt(e.clientY - r.top); draw(); } });
  cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; if (drag >= 0) { vals[drag] = valAt(sy); draw(); } else { const h = idxAt(sx); if (h !== hover) { hover = h; draw(); } } });
  cv.addEventListener('pointerup', () => { drag = -1; draw(); });
  cv.addEventListener('pointerleave', () => { if (drag < 0) { hover = -1; draw(); } });
  cv._redraw = draw; cv._get = () => vals.slice();
  cv._set = v => { vals = v.slice(); if (!vals.length) vals = [1]; top = Math.max(3, Math.ceil(Math.max(...vals))); draw(); };
  return cv;
}
function curveEditor(initial) {
  const cv = edCanvas(160);
  let pts = (initial || []).map(p => ({ x: p.x, y: p.y })); if (pts.length < 2) pts = [{ x: 0, y: 50 }, { x: 50, y: 30 }];
  let bx0, bx1, by0, by1;
  function bounds() {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 - x0 < 1e-6) { x0 -= 1; x1 += 1; } if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
    const mx = (x1 - x0) * 0.1, my = (y1 - y0) * 0.15;
    bx0 = x0 - mx; bx1 = x1 + mx; by0 = Math.max(0, y0 - my); by1 = y1 + my;
  }
  bounds();
  const PL = 36, PR = 10, PT = 10, PB = 20; let drag = -1;
  const X = x => PL + (x - bx0) / (bx1 - bx0) * (cv.clientWidth - PL - PR);
  const Y = y => PT + (cv.clientHeight - PT - PB) - (y - by0) / (by1 - by0) * (cv.clientHeight - PT - PB);
  const invX = sx => bx0 + (sx - PL) / (cv.clientWidth - PL - PR) * (bx1 - bx0);
  const invY = sy => by0 + (PT + (cv.clientHeight - PT - PB) - sy) / (cv.clientHeight - PT - PB) * (by1 - by0);
  function draw() {
    const { c, W, H } = edSetup(cv); const p = pal();
    c.font = '10px system-ui, sans-serif'; c.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = PT + (H - PT - PB) * g / 4, x = PL + (W - PL - PR) * g / 4;
      c.strokeStyle = p.grid; c.beginPath(); c.moveTo(PL, y); c.lineTo(W - PR, y); c.stroke();
      c.beginPath(); c.moveTo(x, PT); c.lineTo(x, H - PB); c.stroke();
      c.fillStyle = p.labelDim; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(fmt(by1 - (by1 - by0) * g / 4), PL - 4, y);
      c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(fmt(bx0 + (bx1 - bx0) * g / 4), x, H - PB + 4);
    }
    const s = [...pts].sort((a, b) => a.x - b.x);
    c.strokeStyle = p.sel; c.lineWidth = 2; c.beginPath();
    s.forEach((pt, i) => { const x = X(pt.x), y = Y(pt.y); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    pts.forEach((pt, i) => { c.fillStyle = (i === drag) ? p.hover : p.sel; c.beginPath(); c.arc(X(pt.x), Y(pt.y), i === drag ? 6 : 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = p.nodeEdge; c.lineWidth = 1; c.stroke(); });
  }
  const hit = (sx, sy) => { for (let i = 0; i < pts.length; i++) if (Math.hypot(sx - X(pts[i].x), sy - Y(pts[i].y)) < 8) return i; return -1; };
  cv.addEventListener('pointerdown', e => { const r = cv.getBoundingClientRect(); drag = hit(e.clientX - r.left, e.clientY - r.top); if (drag >= 0) { try { cv.setPointerCapture(e.pointerId); } catch (_) {} } });
  cv.addEventListener('pointermove', e => { if (drag < 0) return; const r = cv.getBoundingClientRect(); pts[drag].x = Math.round(Math.max(bx0, Math.min(bx1, invX(e.clientX - r.left))) * 100) / 100; pts[drag].y = Math.round(Math.max(by0, Math.min(by1, invY(e.clientY - r.top))) * 100) / 100; draw(); });
  cv.addEventListener('pointerup', () => { drag = -1; draw(); });
  cv.addEventListener('dblclick', e => { const r = cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; const h = hit(sx, sy); if (h >= 0) { if (pts.length > 2) { pts.splice(h, 1); draw(); } } else { pts.push({ x: Math.round(invX(sx) * 100) / 100, y: Math.round(invY(sy) * 100) / 100 }); draw(); } });
  cv._redraw = draw; cv._get = () => pts.map(p => ({ x: p.x, y: p.y }));
  cv._set = v => { pts = v.map(p => ({ x: p.x, y: p.y })); if (pts.length < 2) pts = [{ x: 0, y: 50 }, { x: 50, y: 30 }]; bounds(); draw(); };
  return cv;
}
function patternRow(id, values) {
  const row = document.createElement('div'); row.className = 'data-card';
  const head = document.createElement('div'); head.className = 'data-card-head';
  const idIn = textInput(id, () => {}); idIn.className = 'did'; head.appendChild(idIn);
  const ed = barEditor(values);
  head.appendChild(selectInput('', [['', t('data.preset')], ['const', t('preset.const')], ['diurnal', t('preset.diurnal')], ['night', t('preset.night')]], v => { if (!v) return; ed._set(presetValues(v, ed._get().length || 24)); }));
  head.appendChild(btnSm(t('data.addStep'), () => { const v = ed._get(); v.push(v.length ? v[v.length - 1] : 1); ed._set(v); }));
  head.appendChild(btnSm(t('data.delStep'), () => { const v = ed._get(); if (v.length > 1) { v.pop(); ed._set(v); } }));
  head.appendChild(btnSm('✕', () => row.remove()));
  row.appendChild(head); row.appendChild(ed);
  const hint = document.createElement('div'); hint.className = 'ed-hint'; hint.textContent = t('data.edHintBar'); row.appendChild(hint);
  row._ed = ed; row._idIn = idIn;
  return row;
}
function curveRow(id, type, points) {
  const row = document.createElement('div'); row.className = 'data-card';
  const head = document.createElement('div'); head.className = 'data-card-head';
  const idIn = textInput(id, () => {}); idIn.className = 'did'; head.appendChild(idIn);
  const typeSel = selectInput(type, CURVE_TYPES.map(c => [c, c]), () => {}); typeSel.className = 'dtype'; head.appendChild(typeSel);
  const ed = curveEditor(points);
  head.appendChild(btnSm(t('data.addPoint'), () => { const v = ed._get(); const last = v[v.length - 1]; v.push({ x: last.x + 10, y: Math.max(0, last.y - 5) }); ed._set(v); }));
  head.appendChild(btnSm(t('data.delPoint'), () => { const v = ed._get(); if (v.length > 2) { v.pop(); ed._set(v); } }));
  head.appendChild(btnSm('✕', () => row.remove()));
  row.appendChild(head); row.appendChild(ed);
  const hint = document.createElement('div'); hint.className = 'ed-hint'; hint.textContent = t('data.edHintCurve'); row.appendChild(hint);
  row._ed = ed; row._idIn = idIn; row._typeSel = typeSel;
  return row;
}
/* ---- structured control rules ---- */
function parseControl(line) {
  let m = line.match(/^LINK\s+(\S+)\s+(OPEN|CLOSED|[\d.]+)\s+IF\s+NODE\s+(\S+)\s+(ABOVE|BELOW)\s+([\d.-]+)\s*$/i);
  if (m) { const set = /^[\d.]+$/.test(m[2]); return { link: m[1], action: set ? 'SET' : m[2].toUpperCase(), setting: set ? parseFloat(m[2]) : 0, cond: 'NODE', node: m[3], op: m[4].toUpperCase(), value: parseFloat(m[5]), clock: '06:00' }; }
  m = line.match(/^LINK\s+(\S+)\s+(OPEN|CLOSED|[\d.]+)\s+AT\s+CLOCKTIME\s+(\d{1,2}:\d{2})\s*$/i);
  if (m) { const set = /^[\d.]+$/.test(m[2]); return { link: m[1], action: set ? 'SET' : m[2].toUpperCase(), setting: set ? parseFloat(m[2]) : 0, cond: 'TIME', node: '', op: 'BELOW', value: 0, clock: m[3] }; }
  return { raw: line };
}
function controlString(r) {
  if (r.raw !== undefined) return r.raw.trim();
  if (!r.link) return '';
  const act = r.action === 'SET' ? String(r.setting) : r.action;
  if (r.cond === 'NODE') { if (!r.node) return ''; return `LINK ${r.link} ${act} IF NODE ${r.node} ${r.op} ${r.value}`; }
  return `LINK ${r.link} ${act} AT CLOCKTIME ${r.clock}`;
}
function controlRow(rule) {
  const row = document.createElement('div'); row.className = 'ctl-row'; row._rule = rule;
  function rebuild() {
    row.innerHTML = '';
    if (rule.raw !== undefined) { const ti = textInput(rule.raw, v => { rule.raw = v; }); ti.className = 'ctl-raw'; row.appendChild(ti); row.appendChild(btnSm('✕', () => row.remove())); return; }
    const mk = (label, el) => { const f = field(label, el); f.className = 'field ctl-field'; row.appendChild(f); };
    mk(t('ctl.link'), selectInput(rule.link, linkOptions(), v => { rule.link = v; }));
    mk(t('ctl.action'), selectInput(rule.action, [['OPEN', t('ctl.open')], ['CLOSED', t('ctl.closed')], ['SET', t('ctl.set')]], v => { rule.action = v; rebuild(); }));
    if (rule.action === 'SET') mk(t('ctl.setting'), numInput(rule.setting, v => { rule.setting = v; }, '0.1'));
    mk(t('ctl.cond'), selectInput(rule.cond, [['NODE', t('ctl.condNode')], ['TIME', t('ctl.condTime')]], v => { rule.cond = v; rebuild(); }));
    if (rule.cond === 'NODE') {
      mk(t('ctl.node'), selectInput(rule.node, nodeOptions(), v => { rule.node = v; }));
      mk(t('ctl.op'), selectInput(rule.op, [['BELOW', t('ctl.below')], ['ABOVE', t('ctl.above')]], v => { rule.op = v; }));
      mk(t('ctl.value'), numInput(rule.value, v => { rule.value = v; }, '0.1'));
    } else {
      const ti = document.createElement('input'); ti.type = 'time'; ti.value = rule.clock; ti.addEventListener('change', () => { rule.clock = ti.value || '00:00'; });
      mk(t('ctl.clock'), ti);
    }
    row.appendChild(btnSm('✕', () => row.remove()));
  }
  rebuild();
  return row;
}
function ruleRow(text) {
  const row = document.createElement('div'); row.className = 'data-card';
  const head = document.createElement('div'); head.className = 'data-card-head';
  head.appendChild(btnSm('✕', () => row.remove()));
  row.appendChild(head);
  const ta = document.createElement('textarea'); ta.className = 'rule-text'; ta.value = text || ''; ta.rows = 5;
  ta.spellcheck = false; row.appendChild(ta);
  const hint = document.createElement('div'); hint.className = 'ed-hint'; hint.textContent = t('rule.hint'); row.appendChild(hint);
  row._ta = ta;
  return row;
}
function openData() {
  $('dataModal').hidden = false;
  dataEditors.length = 0;
  const pl = $('patternList'); pl.innerHTML = '';
  state.net.patterns.forEach(p => pl.appendChild(patternRow(p.id, p.values)));
  const cl = $('curveList'); cl.innerHTML = '';
  state.net.curves.forEach(c => cl.appendChild(curveRow(c.id, c.type, c.points)));
  const ctl = $('controlList'); ctl.innerHTML = '';
  state.net.controls.forEach(line => ctl.appendChild(controlRow(parseControl(line))));
  const rl = $('ruleList'); rl.innerHTML = '';
  (state.net.rules || []).forEach(r => rl.appendChild(ruleRow(r)));
  redrawEditors();
}
function applyData() {
  const patterns = [];
  $('patternList').querySelectorAll('.data-card').forEach(r => { const id = r._idIn.value.trim(); if (!id) return; patterns.push({ id, values: r._ed._get() }); });
  const curves = [];
  $('curveList').querySelectorAll('.data-card').forEach(r => { const id = r._idIn.value.trim(); if (!id) return; curves.push({ id, type: r._typeSel.value, points: r._ed._get() }); });
  const controls = [];
  $('controlList').querySelectorAll('.ctl-row').forEach(r => { const s = controlString(r._rule); if (s) controls.push(s); });
  const rules = [];
  $('ruleList').querySelectorAll('.data-card').forEach(r => { const s = r._ta.value.trim(); if (s) rules.push(s); });
  state.net.patterns = patterns; state.net.curves = curves; state.net.controls = controls; state.net.rules = rules;
  $('dataModal').hidden = true; markDirty(true); buildSettings(); toast(t('toast.dataApplied'), 'ok');
}
$('btnAddPattern').addEventListener('click', () => { const r = patternRow(genId('PAT', state.net.patterns), [1, 1, 1, 1]); $('patternList').appendChild(r); r._ed._redraw(); });
$('btnAddCurve').addEventListener('click', () => { const r = curveRow(genId('C', state.net.curves), 'PUMP', [{ x: 0, y: 50 }, { x: 50, y: 30 }]); $('curveList').appendChild(r); r._ed._redraw(); });
$('btnAddControl').addEventListener('click', () => { $('controlList').appendChild(controlRow({ link: (state.net.links[0] || {}).id || '', action: 'OPEN', setting: 0, cond: 'NODE', node: (state.net.nodes[0] || {}).id || '', op: 'BELOW', value: 0, clock: '06:00' })); });
$('btnAddRule').addEventListener('click', () => { const n = (state.net.rules || []).length + 1; $('ruleList').appendChild(ruleRow(`RULE ${n}\nIF NODE ${(state.net.nodes[0] || {}).id || 'J1'} PRESSURE > 20\nTHEN LINK ${(state.net.links[0] || {}).id || 'P1'} STATUS = OPEN\nELSE LINK ${(state.net.links[0] || {}).id || 'P1'} STATUS = CLOSED`)); });
$('btnData').addEventListener('click', openData);
$('btnCloseData').addEventListener('click', () => { $('dataModal').hidden = true; });
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
  updateTimeUI(); renderTables(); renderStats(); renderReport(); syncColorUI(); renderLegend(); buildPropsForm(); resize();
  $('rpSummary').textContent = t('rp.summary', state.results.nodes.length, state.results.links.length, state.results.times.length);
}
function clearResults() {
  state.results = null; state.resNode = {}; state.resLink = {}; state.playing = false; state.stale = false;
  $('resultBar').hidden = true; $('resultsPanel').hidden = true; updateRunButton();
  stopPlay(); resize();
}
function updateTimeUI() {
  const sec = state.results.times[state.timeIndex];
  $('timeLabel').textContent = 't = ' + clock(sec);
  $('timeSlider').value = state.timeIndex;
  if (!$('canvasTip').hidden && state.hover) updateTip(state.hover, state.mouse.sx, state.mouse.sy);
  redrawChartIfOpen();
}
$('timeSlider').addEventListener('input', e => { state.timeIndex = +e.target.value; updateTimeUI(); renderTables(); renderLegend(); buildPropsForm(); render(); });
$('nodeColor').addEventListener('change', e => { state.nodeColor = e.target.value; renderLegend(); render(); });
$('linkColor').addEventListener('change', e => { state.linkColor = e.target.value; renderLegend(); render(); });
$('chkColorByValue').addEventListener('change', e => { state.colorByValue = e.target.checked; syncColorUI(); renderLegend(); render(); });
function syncColorUI() {
  $('chkColorByValue').checked = state.colorByValue;
  $('nodeColor').disabled = !state.colorByValue;
  $('linkColor').disabled = !state.colorByValue;
}
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
  if (!state.colorByValue) { el.innerHTML = `<span>${esc(t('rb.legendType'))}</span>`; return; }
  const u = state.results.units;
  const nr = metricRange(state.results.nodes, state.nodeColor);
  const unit = metricUnit(state.nodeColor);
  const grad = `linear-gradient(90deg, ${SCALE.map(s => s[1]).join(',')})`;
  el.innerHTML = `<span>${labelFor(state.nodeColor)}</span><span class="legend-gradient" style="background:${grad}"></span><span>${fmt(nr.min)} ~ ${fmt(nr.max)} ${unit}</span>`;
}
const METRIC_LABEL = { demandDeficit: 'deficit' };
function labelFor(k) { const lk = METRIC_LABEL[k] || k; const s = t('m.' + lk); return s !== 'm.' + lk ? s : k; }
function metricUnit(k) {
  const u = state.results ? state.results.units : {};
  switch (k) {
    case 'pressure': return u.pressure;
    case 'head': case 'level': return u.head;
    case 'demand': case 'flow': case 'demandDeficit': return u.flow;
    case 'velocity': return u.velocity;
    case 'headloss': return u.headloss;
    case 'quality': return u.quality || '';
    case 'energy': return 'kWh';
    case 'efficiency': return '%';
    case 'power': return 'kW';
    case 'volume': return 'm³';
    default: return '';
  }
}

/* ============================ result tables ============================ */
document.querySelectorAll('.rptab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.rptab').forEach(x => x.classList.toggle('active', x === b));
  const tab = b.dataset.rptab;
  $('nodeTableWrap').hidden = tab !== 'nodes'; $('linkTableWrap').hidden = tab !== 'links';
  $('statsWrap').hidden = tab !== 'stats'; $('reportWrap').hidden = tab !== 'report';
  $('warningsWrap').hidden = tab !== 'warnings';
  if (tab === 'report') ensureReport().catch(e => toast(t('err.report') + e.message, 'err'));
}));
$('btnToggleResults').addEventListener('click', () => $('resultsPanel').classList.toggle('collapsed'));

function renderTables() {
  if (!state.results) return;
  const ti = state.timeIndex, u = state.results.units;
  // nodes
  const hasLevel = state.results.nodes.some(n => n.level);
  const hasDeficit = state.results.nodes.some(n => n.demandDeficit);
  let h = `<table><thead><tr><th>${t('th.id')}</th><th>${t('th.type')}</th><th>${t('th.elev')}</th><th>${t('th.pressure')} (${u.pressure})</th><th>${t('th.head')} (${u.head})</th><th>${t('th.demand')} (${u.flow})</th>`;
  if (hasLevel) h += `<th>${t('m.level')} (${u.head})</th>`;
  if (hasDeficit) h += `<th>${t('m.deficit')} (${u.flow})</th>`;
  if (u.quality) h += `<th>${t('th.quality')} (${u.quality})</th>`;
  h += `</tr></thead><tbody>`;
  state.results.nodes.forEach(n => {
    const p = n.pressure[ti]; const bad = n.type === 'JUNCTION' && p < 0;
    h += `<tr data-kind="node" data-id="${esc(n.id)}"><td>${esc(n.id)}</td><td>${n.type}</td><td class="num">${fmt(nodeById(n.id) ? nodeById(n.id).elevation : 0)}</td><td class="num ${bad ? 'cell-bad' : ''}">${fmt(p)}</td><td class="num">${fmt(n.head[ti])}</td><td class="num">${fmt(n.demand[ti])}</td>`;
    if (hasLevel) h += `<td class="num">${fmt(n.level ? n.level[ti] : NaN)}</td>`;
    if (hasDeficit) h += `<td class="num">${fmt(n.demandDeficit ? n.demandDeficit[ti] : NaN)}</td>`;
    if (u.quality) h += `<td class="num">${fmt(n.quality[ti])}</td>`;
    h += `</tr>`;
  });
  h += `</tbody></table>`;
  $('nodeTableWrap').innerHTML = h;
  // links
  const hasSetting = state.results.links.some(l => l.setting);
  const hasEnergy = state.results.links.some(l => l.energy);
  let hl = `<table><thead><tr><th>${t('th.id')}</th><th>${t('th.type')}</th><th>${t('th.fromTo')}</th><th>${t('th.flow')} (${u.flow})</th><th>${t('th.velocity')} (${u.velocity})</th><th>${t('th.headloss')} (${u.headloss})</th><th>${t('th.status')}</th>`;
  if (hasSetting) hl += `<th>${t('m.setting')}</th>`;
  if (hasEnergy) hl += `<th>${t('m.energy')} (kWh)</th>`;
  hl += `</tr></thead><tbody>`;
  state.results.links.forEach(l => {
    const st = l.status[ti] > 0.5 ? t('status.open') : t('status.closed');
    const vwarn = Math.abs(l.velocity[ti]) > 2 ? 'cell-warn' : '';
    hl += `<tr data-kind="link" data-id="${esc(l.id)}"><td>${esc(l.id)}</td><td>${l.type}</td><td>${esc(l.from)}→${esc(l.to)}</td><td class="num">${fmt(l.flow[ti])}</td><td class="num ${vwarn}">${fmt(l.velocity[ti])}</td><td class="num">${fmt(l.headloss[ti])}</td><td>${st}</td>`;
    if (hasSetting) hl += `<td class="num">${fmt(l.setting ? l.setting[ti] : NaN)}</td>`;
    if (hasEnergy) hl += `<td class="num">${fmt(l.energy ? l.energy[ti] : NaN)}</td>`;
    hl += `</tr>`;
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
function renderStats() {
  const el = $('statsWrap'); if (!state.results) { el.innerHTML = ''; return; }
  const s = state.results.statistics;
  if (!s) { el.innerHTML = `<div class="warn-none">${esc(t('stat.title'))}: –</div>`; return; }
  const cards = [
    ['stat.iterations', s.iterations, '', true],
    ['stat.relError', s.relativeError, ''],
    ['stat.maxHeadError', s.maxHeadError, state.results.units.head],
    ['stat.maxFlowChange', s.maxFlowChange, state.results.units.flow],
    ['stat.massBalance', s.massBalance, ''],
    ['stat.deficientNodes', s.deficientNodes, '', true],
    ['stat.demandReduction', s.demandReduction, '%'],
    ['stat.leakageLoss', s.leakageLoss, '%'],
  ];
  el.innerHTML = `<div class="stats-grid">` + cards.map(([k, v, un, isInt]) =>
    `<div class="stat-card"><div class="sk">${esc(t(k))}</div><div class="sv">${typeof v === 'number' ? (isInt ? String(Math.round(v)) : fmt(v)) : esc(v)}${un ? ' ' + esc(un) : ''}</div></div>`).join('') + `</div>`;
}
function renderReport() {
  const el = $('reportWrap'); if (!state.results) { el.innerHTML = ''; return; }
  const rpt = state.results.report;
  el.innerHTML = rpt ? `<pre class="report-text">${esc(rpt)}</pre>` : `<div class="warn-none">${esc(t('report.title'))}: ${esc(t('btn.report'))} →</div>`;
}
async function ensureReport() {
  if (!state.results) return '';
  if (state.results.report) return state.results.report;
  const res = await api('/api/report', 'POST', state.net);
  if (res && res.ok) {
    state.results.report = res.report || '';
    if (res.statistics) state.results.statistics = res.statistics;
    renderReport(); renderStats();
  } else if (res && res.error) {
    toast(t('err.report') + res.error, 'err');
  }
  return state.results.report || '';
}

/* ============================ results export & chart ============================ */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCsv() {
  if (!state.results) { toast(t('chart.noResults'), 'err'); return; }
  const u = state.results.units, times = state.results.times;
  const rows = [['kind', 'id', 'type', 'time_s',
    'pressure_' + u.pressure, 'head_' + u.head, 'demand_' + u.flow, 'quality' + (u.quality ? '_' + u.quality : ''),
    'flow_' + u.flow, 'velocity_' + u.velocity, 'headloss_' + u.headloss, 'status'].join(',')];
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : '';
  state.results.nodes.forEach(n => times.forEach((sec, i) => {
    rows.push(['node', csvCell(n.id), n.type, sec,
      num(n.pressure[i]), num(n.head[i]), num(n.demand[i]), num(n.quality ? n.quality[i] : ''),
      '', '', '', ''].join(','));
  }));
  state.results.links.forEach(l => times.forEach((sec, i) => {
    rows.push(['link', csvCell(l.id), l.type, sec,
      '', '', '', '',
      num(l.flow[i]), num(l.velocity[i]), num(l.headloss[i]), num(l.status[i])].join(','));
  }));
  download(rows.join('\r\n'), 'epanet-results.csv', 'text/csv;charset=utf-8');
}
function chartSeries() {
  if (!state.sel || !state.results) return null;
  const isNode = state.sel.kind === 'node';
  const rs = isNode ? state.resNode[state.sel.id] : state.resLink[state.sel.id];
  if (!rs) return null;
  let metric = isNode ? state.nodeColor : state.linkColor;
  if (metric === 'status' || !rs[metric]) metric = isNode ? 'pressure' : 'flow';
  return { id: state.sel.id, metric, values: rs[metric], unit: metricUnit(metric) };
}
function openChart() {
  if (!state.results) { toast(t('chart.noResults'), 'err'); return; }
  if (!chartSeries()) { toast(t('chart.noSel'), 'err'); return; }
  $('chartModal').hidden = false;
  drawChart();
}
function drawChart() {
  const s = chartSeries(); if (!s) return;
  $('chartTitle').textContent = s.id + ' · ' + labelFor(s.metric) + (s.unit ? ' (' + s.unit + ')' : '');
  const cv = $('chartCanvas'), p = pal();
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 480, H = cv.clientHeight || 280;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const vals = s.values, times = state.results.times, n = vals.length;
  let min = Infinity, max = -Infinity;
  vals.forEach(v => { if (typeof v === 'number' && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } });
  if (!isFinite(min)) { min = 0; max = 1; }
  if (min === max) { min -= 1; max += 1; }
  const padL = 52, padR = 14, padT = 14, padB = 28;
  const pw = Math.max(1, W - padL - padR), ph = Math.max(1, H - padT - padB);
  const X = i => padL + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const Y = v => padT + ph - ((v - min) / (max - min)) * ph;
  c.font = '11px system-ui, sans-serif'; c.lineWidth = 1;
  const gy = 4;
  for (let g = 0; g <= gy; g++) {
    const v = min + (max - min) * (g / gy), y = Y(v);
    c.strokeStyle = p.grid; c.beginPath(); c.moveTo(padL, y); c.lineTo(W - padR, y); c.stroke();
    c.fillStyle = p.labelDim; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(fmt(v), padL - 6, y);
  }
  const nx = Math.min(6, n);
  c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = p.labelDim;
  for (let k = 0; k < nx; k++) {
    const i = nx > 1 ? Math.round(k * (n - 1) / (nx - 1)) : 0;
    c.fillText(clock(times[i]), X(i), H - padB + 6);
  }
  c.strokeStyle = p.sel; c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath();
  vals.forEach((v, i) => { const x = X(i), y = Y(v); i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.stroke();
  const ti = Math.max(0, Math.min(n - 1, state.timeIndex)), mx = X(ti), my = Y(vals[ti]);
  c.strokeStyle = p.hover; c.lineWidth = 1; c.beginPath(); c.moveTo(mx, padT); c.lineTo(mx, H - padB); c.stroke();
  c.fillStyle = p.sel; c.beginPath(); c.arc(mx, my, 3.5, 0, Math.PI * 2); c.fill();
}
function redrawChartIfOpen() { if (!$('chartModal').hidden) drawChart(); }
$('btnExportCsv').addEventListener('click', exportCsv);
$('btnReport').addEventListener('click', async () => {
  if (!state.results) { toast(t('chart.noResults'), 'err'); return; }
  try {
    const rpt = await ensureReport();
    if (rpt) { download(rpt, (state.net.title || 'network') + '.rpt', 'text/plain;charset=utf-8'); toast(t('toast.reportDone'), 'ok'); }
  } catch (e) { toast(t('err.report') + e.message, 'err'); }
});
$('btnChart').addEventListener('click', openChart);
$('btnCloseChart').addEventListener('click', () => { $('chartModal').hidden = true; });
$('btnCloseChart2').addEventListener('click', () => { $('chartModal').hidden = true; });
$('chartModal').addEventListener('click', e => { if (e.target === $('chartModal')) $('chartModal').hidden = true; });

/* ============================ file ops ============================ */
async function loadExample() {
  try { const net = await api('/api/example'); loadNetwork(net); fitView(); toast(t('toast.exampleLoaded'), 'ok'); }
  catch (e) { toast(t('err.exampleLoad') + e.message, 'err'); }
}
function loadNetwork(net) {
  // normalize
  net.nodes = net.nodes || []; net.links = net.links || [];
  net.patterns = net.patterns || []; net.curves = net.curves || []; net.controls = net.controls || [];
  net.rules = net.rules || [];
  net.options = { ...DEFAULT_OPTIONS, ...(net.options || {}) };
  net.times = { ...DEFAULT_TIMES, ...(net.times || {}) };
  net.quality = { type: 'NONE', chemName: 'Chlorine', chemUnits: 'mg/L', traceNode: '', ...(net.quality || {}) };
  net.reactions = { ...DEFAULT_REACTIONS, ...(net.reactions || {}) };
  net.energy = { ...DEFAULT_ENERGY, ...(net.energy || {}) };
  net.demandModel = { ...DEFAULT_DEMAND_MODEL, ...(net.demandModel || {}) };
  net.geo = { ...defaultGeo(), ...(net.geo || {}) };
  net.nodes.forEach(n => { n.vertices = n.vertices || []; });
  net.links.forEach(l => { l.vertices = l.vertices || []; });
  state.net = net; select(null); clearResults(); buildSettings(); renderElemList(); syncMapUI(); render(); autosave();
  resetHistory();
}
$('btnNew').addEventListener('click', () => { if (confirm(t('confirm.new'))) openWizard('new'); });

$('btnExample').addEventListener('click', loadExample);
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
  updateEngineBadge(); updateRunButton(); updateThemeBtn();
  setTool(state.tool); renderElemList(); buildPropsForm(); buildSettings();
  if (state.wizard) renderWizard();
  if (!$('mapPanel').hidden) buildMapPanel();
  if (!$('reviewModal').hidden) { state.review = reviewNetwork(); renderReview(); }
  if (!$('gisModal').hidden) renderGisModal();
  if (!$('dataModal').hidden) redrawEditors();
  updateAttribution();
  if (state.results) {
    renderTables(); renderLegend(); updateTimeUI();
    $('rpSummary').textContent = t('rp.summary', state.results.nodes.length, state.results.links.length, state.results.times.length);
    redrawChartIfOpen();
  }
}
$('langSelect').value = LANG;
$('langSelect').addEventListener('change', e => setLang(e.target.value));
document.addEventListener('langchange', () => { $('langSelect').value = LANG; refreshLangUI(); });

/* ============================ theme ============================ */
try {
  const saved = localStorage.getItem('epanet-web-theme');
  if (saved === 'dark' || saved === 'light') state.theme = saved;
  else if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) state.theme = 'dark';
} catch (e) {}
document.documentElement.dataset.theme = state.theme;

function updateThemeBtn() {
  const btn = $('btnTheme');
  const dark = state.theme === 'dark';
  btn.textContent = dark ? '☀' : '☾';
  btn.title = t(dark ? 'theme.toLight' : 'theme.toDark');
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  updateThemeBtn();
  try { localStorage.setItem('epanet-web-theme', state.theme); } catch (e) {}
  renderElemList();
  render();
  redrawChartIfOpen();
  redrawEditors();
}
$('btnTheme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
});

/* ============================ network review ============================ */
function rvDeleteNode(id) {
  state.net.nodes = state.net.nodes.filter(n => n.id !== id);
  state.net.links = state.net.links.filter(l => l.from !== id && l.to !== id);
}
function rvDeleteLink(id) { state.net.links = state.net.links.filter(l => l.id !== id); }
function reviewNetwork() {
  const net = state.net, issues = [];
  const add = (sev, key, args, target, fix) => issues.push({ sev, msg: t(key, ...(args || [])), target: target || null, fix: fix || null });
  const nodeIds = new Set(net.nodes.map(n => n.id));
  const deg = {}; net.nodes.forEach(n => deg[n.id] = 0);
  net.links.forEach(l => { if (deg[l.from] !== undefined) deg[l.from]++; if (deg[l.to] !== undefined) deg[l.to]++; });
  const seenN = new Set(), seenL = new Set();
  net.nodes.forEach(n => {
    if (seenN.has(n.id)) add('error', 'review.dupNodeId', [n.id], { kind: 'node', id: n.id }, () => { n.id = genId('J', state.net.nodes); });
    seenN.add(n.id);
  });
  net.links.forEach(l => {
    if (seenL.has(l.id)) add('error', 'review.dupLinkId', [l.id], { kind: 'link', id: l.id }, () => { l.id = genId('P', state.net.links); });
    seenL.add(l.id);
  });
  net.links.forEach(l => {
    if (!nodeIds.has(l.from) || !nodeIds.has(l.to)) add('error', 'review.dangling', [l.id], { kind: 'link', id: l.id }, () => rvDeleteLink(l.id));
  });
  if (!net.nodes.some(n => n.type === 'RESERVOIR' || n.type === 'TANK')) add('error', 'review.noSource', [], null, null);
  net.nodes.forEach(n => {
    if (deg[n.id] === 0) {
      const src = n.type === 'RESERVOIR' || n.type === 'TANK';
      add('warn', src ? 'review.orphanSource' : 'review.orphan', [n.id], { kind: 'node', id: n.id }, () => rvDeleteNode(n.id));
    }
    if (n.elevation < 0) add('warn', 'review.negElev', [n.id], { kind: 'node', id: n.id }, () => { n.elevation = 0; });
  });
  const pair = {};
  net.links.forEach(l => {
    const k = [l.from, l.to].sort().join('|');
    pair[k] = (pair[k] || 0) + 1;
    if (pair[k] > 1) add('warn', 'review.parallel', [l.id], { kind: 'link', id: l.id }, () => rvDeleteLink(l.id));
    if (l.type !== 'PUMP' && l.diameter <= 0) add('error', 'review.badDiam', [l.id], { kind: 'link', id: l.id }, () => { l.diameter = 200; });
    if (l.type === 'PIPE' && l.length <= 0) add('error', 'review.badLength', [l.id], { kind: 'link', id: l.id }, () => { l.length = 300; });
  });
  // connected components without a source
  const adj = {}; net.nodes.forEach(n => adj[n.id] = []);
  net.links.forEach(l => { if (adj[l.from] && adj[l.to]) { adj[l.from].push(l.to); adj[l.to].push(l.from); } });
  const seen = new Set();
  net.nodes.forEach(start => {
    if (seen.has(start.id)) return;
    const comp = [], stack = [start.id]; seen.add(start.id);
    while (stack.length) { const id = stack.pop(); comp.push(id); (adj[id] || []).forEach(nb => { if (!seen.has(nb)) { seen.add(nb); stack.push(nb); } }); }
    if (comp.length < 2) return;
    const hasSrc = comp.some(id => { const n = nodeById(id); return n && (n.type === 'RESERVOIR' || n.type === 'TANK'); });
    if (!hasSrc) add('warn', 'review.unsupplied', [comp.length], { kind: 'node', id: comp[0] }, null);
  });
  return issues;
}
function openReview() { state.review = reviewNetwork(); renderReview(); $('reviewModal').hidden = false; }
function renderReview() {
  const issues = state.review || [];
  const errs = issues.filter(i => i.sev === 'error').length, warns = issues.filter(i => i.sev === 'warn').length;
  $('reviewSummary').textContent = issues.length ? t('review.summary', errs, warns) : '';
  const list = $('reviewList'); list.innerHTML = '';
  if (!issues.length) list.innerHTML = `<div class="review-empty">${esc(t('review.empty'))}</div>`;
  issues.forEach(it => {
    const row = document.createElement('div'); row.className = 'review-item ' + it.sev;
    const msg = document.createElement('span'); msg.className = 'msg'; msg.textContent = it.msg; row.appendChild(msg);
    if (it.target) { const b = document.createElement('button'); b.className = 'btn btn-sm'; b.textContent = t('review.locate'); b.addEventListener('click', () => { $('reviewModal').hidden = true; select(it.target); centerOn(selObj()); }); row.appendChild(b); }
    if (it.fix) { const f = document.createElement('button'); f.className = 'btn btn-sm'; f.textContent = t('review.fix'); f.addEventListener('click', () => { it.fix(); afterFix(); }); row.appendChild(f); }
    list.appendChild(row);
  });
  $('btnFixAll').disabled = !issues.some(i => i.fix);
}
function afterFix() { markDirty(true); renderElemList(); buildPropsForm(); render(); state.review = reviewNetwork(); renderReview(); }
function fixAll() { (state.review || []).filter(i => i.fix).forEach(i => i.fix()); afterFix(); }
$('btnReview').addEventListener('click', openReview);
$('btnCloseReview').addEventListener('click', () => { $('reviewModal').hidden = true; });
$('btnCloseReview2').addEventListener('click', () => { $('reviewModal').hidden = true; });
$('btnFixAll').addEventListener('click', fixAll);
$('reviewModal').addEventListener('click', e => { if (e.target === $('reviewModal')) $('reviewModal').hidden = true; });

/* ============================ undo / redo wiring ============================ */
$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
  }
});

/* ============================ GIS import ============================ */
let gisData = null;
const gisMap = { id: '', type: '', elev: '', demand: '', lon: '', lat: '' };
function csvParse(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
function guessLon(h) { return h.find(k => /^(lon|lng|long|longitude)$/i.test(k)) || h.find(k => /lon|lng/i.test(k)) || ''; }
function guessLat(h) { return h.find(k => /^(lat|latitude)$/i.test(k)) || h.find(k => /lat/i.test(k)) || ''; }
function parseGis(name, text) {
  if (/\.csv$/i.test(name)) {
    const rows = csvParse(text);
    if (rows.length < 2) throw new Error('empty CSV');
    const header = rows[0].map(h => h.trim());
    const points = rows.slice(1).map(r => { const props = {}; header.forEach((h, i) => props[h] = r[i] !== undefined ? r[i].trim() : ''); return { props }; });
    return { kind: 'csv', points, lines: [], fields: header };
  }
  const gj = JSON.parse(text);
  const feats = gj.type === 'FeatureCollection' ? (gj.features || []) : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', geometry: gj, properties: {} }];
  const points = [], lines = [], fieldSet = new Set();
  feats.forEach(f => {
    const g = f.geometry; if (!g) return;
    const props = f.properties || {}; Object.keys(props).forEach(k => fieldSet.add(k));
    if (g.type === 'Point') points.push({ lon: g.coordinates[0], lat: g.coordinates[1], props });
    else if (g.type === 'MultiPoint') g.coordinates.forEach(c => points.push({ lon: c[0], lat: c[1], props }));
    else if (g.type === 'LineString') lines.push({ coords: g.coordinates, props });
    else if (g.type === 'MultiLineString') g.coordinates.forEach(c => lines.push({ coords: c, props }));
  });
  return { kind: 'geojson', points, lines, fields: [...fieldSet] };
}
function ptLonLat(p) {
  if (gisData.kind === 'csv') return [parseFloat(p.props[gisMap.lon]), parseFloat(p.props[gisMap.lat])];
  return [p.lon, p.lat];
}
function gisNum(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function nodeTypeFrom(v) { const s = String(v || '').toLowerCase(); if (/reservoir|source|水库/.test(s)) return 'RESERVOIR'; if (/tank|水池|水塔/.test(s)) return 'TANK'; return 'JUNCTION'; }
function linkTypeFrom(v) { const s = String(v || '').toUpperCase(); if (/PUMP|泵/.test(s)) return 'PUMP'; const vlv = VALVE_TYPES.find(x => s.includes(x)); if (vlv) return vlv; if (/VALVE|阀/.test(s)) return 'PRV'; return 'PIPE'; }
function uniqId(base, prefix, arr) { let id = base || genId(prefix, arr); let i = 2; while (arr.some(x => x.id === id)) id = (base || prefix) + '_' + (i++); return id; }
function openGis(name, text) {
  let data;
  try { data = parseGis(name, text); } catch (e) { toast(t('gis.errParse') + e.message, 'err'); return; }
  if (!data.points.length && !data.lines.length) { toast(t('gis.errNoPoints'), 'err'); return; }
  data.name = name; gisData = data;
  const f = data.fields, pick = re => f.find(k => re.test(k)) || '';
  gisMap.id = pick(/^(id|name|node_id|link_id|gid|fid|objectid)$/i) || pick(/id|name/i);
  gisMap.type = pick(/^(type|kind|category|node_type|link_type)$/i) || pick(/type|kind/i);
  gisMap.elev = pick(/^(elev|elevation|z|alt|altitude|height)$/i) || pick(/elev|alt|height/i);
  gisMap.demand = pick(/^(demand|base_demand)$/i) || pick(/demand/i);
  if (data.kind === 'csv') { gisMap.lon = guessLon(f); gisMap.lat = guessLat(f); }
  renderGisModal();
  $('gisModal').hidden = false;
}
function renderGisModal() {
  const body = $('gisBody'); body.innerHTML = '';
  const d = gisData; if (!d) return;
  const sum = document.createElement('div'); sum.className = 'rp-summary';
  sum.textContent = d.name + ' · ' + t('gis.summary', d.points.length, d.lines.length);
  body.appendChild(sum);
  const hint = document.createElement('div'); hint.className = 'map-hint'; hint.textContent = t('gis.hint'); body.appendChild(hint);
  const optFields = [['', t('gis.auto')], ...d.fields.map(f => [f, f])];
  const addRow = (label, key, opts) => body.appendChild(field(label, selectInput(gisMap[key], opts, v => { gisMap[key] = v; })));
  if (d.kind === 'csv') {
    addRow(t('gis.mapLon'), 'lon', d.fields.map(f => [f, f]));
    addRow(t('gis.mapLat'), 'lat', d.fields.map(f => [f, f]));
  }
  addRow(t('gis.mapId'), 'id', optFields);
  addRow(t('gis.mapType'), 'type', optFields);
  addRow(t('gis.mapElev'), 'elev', optFields);
  addRow(t('gis.mapDemand'), 'demand', optFields);
}
function applyGis() {
  const d = gisData; if (!d) return;
  const net = emptyNetwork();
  net.title = d.name.replace(/\.[^.]+$/, '');
  const pts = d.points.map(p => ({ p, ll: ptLonLat(p) })).filter(o => isFinite(o.ll[0]) && isFinite(o.ll[1]));
  const anchor = pts.length ? pts[0].ll : (d.lines.length ? d.lines[0].coords[0] : [0, 0]);
  net.geo = { ...defaultGeo(), enabled: true, lon: anchor[0], lat: anchor[1], ax: 0, ay: 0, scale: 1, rot: 0, anchorNode: '' };
  const oldGeo = state.net.geo; state.net.geo = net.geo;
  const toXY = (lon, lat) => { const [x, y] = mercToNet(lonToMx(lon), latToMy(lat)); return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]; };
  const nodes = [], links = [];
  const mkNode = (type, xy, props) => {
    const prefix = type === 'RESERVOIR' ? 'R' : type === 'TANK' ? 'T' : 'J';
    const id = uniqId(gisMap.id ? String(props[gisMap.id] || '').trim() : '', prefix, nodes);
    const n = { id, type, x: xy[0], y: xy[1], elevation: gisNum(props[gisMap.elev]), demand: gisNum(props[gisMap.demand]), demandPattern: '', head: 50, headPattern: '', initLevel: 5, minLevel: 0, maxLevel: 10, diameter: 20, minVol: 0, volCurve: '', initQual: 0 };
    nodes.push(n); return n;
  };
  pts.forEach(o => mkNode(nodeTypeFrom(gisMap.type ? o.p.props[gisMap.type] : ''), toXY(o.ll[0], o.ll[1]), o.p.props || {}));
  const findNode = xy => nodes.find(n => Math.abs(n.x - xy[0]) < 0.5 && Math.abs(n.y - xy[1]) < 0.5);
  d.lines.forEach(ln => {
    const c = ln.coords; if (!c || c.length < 2) return;
    const a = toXY(c[0][0], c[0][1]), b = toXY(c[c.length - 1][0], c[c.length - 1][1]);
    const na = findNode(a) || mkNode('JUNCTION', a, {});
    const nb = findNode(b) || mkNode('JUNCTION', b, {});
    if (na.id === nb.id) return;
    if (links.some(l => (l.from === na.id && l.to === nb.id) || (l.from === nb.id && l.to === na.id))) return;
    const verts = c.slice(1, -1).map(cc => { const [x, y] = toXY(cc[0], cc[1]); return { x, y }; });
    const all = [a, ...verts.map(v => [v.x, v.y]), b]; let len = 0;
    for (let i = 1; i < all.length; i++) len += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
    const props = ln.props || {};
    const type = linkTypeFrom(gisMap.type ? props[gisMap.type] : '');
    const prefix = type === 'PUMP' ? 'PUMP' : VALVE_TYPES.includes(type) ? 'V' : 'P';
    const id = uniqId(gisMap.id ? String(props[gisMap.id] || '').trim() : '', prefix, links);
    links.push({ id, type, from: na.id, to: nb.id, length: Math.max(1, Math.round(len)), diameter: 200, roughness: 100, minorLoss: 0, status: 'OPEN', power: 0, headCurve: '', speed: 1, speedPattern: '', setting: 20, vertices: verts });
  });
  state.net.geo = oldGeo;
  net.nodes = nodes; net.links = links;
  loadNetwork(net); fitView(); syncMapUI();
  $('gisModal').hidden = true;
  toast(t('gis.done', nodes.length, links.length), 'ok');
}
$('btnGis').addEventListener('click', () => $('fileGis').click());
$('fileGis').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { openGis(f.name, await f.text()); } catch (err) { toast(t('gis.errParse') + err.message, 'err'); }
  e.target.value = '';
});
$('btnGisImport').addEventListener('click', applyGis);
$('btnCloseGis').addEventListener('click', () => { $('gisModal').hidden = true; });
$('btnCloseGis2').addEventListener('click', () => { $('gisModal').hidden = true; });
$('gisModal').addEventListener('click', e => { if (e.target === $('gisModal')) $('gisModal').hidden = true; });

/* ============================ DEM auto-elevation ============================ */
const DEM_Z = 12;
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const demCache = new Map();
function demTile(lon, lat, z) {
  const n = 1 << z;
  const xr = (lon + 180) / 360 * n;
  const latR = lat * Math.PI / 180;
  const yr = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
  const x = Math.floor(xr), y = Math.floor(yr);
  return { x, y, px: (xr - x) * 256, py: (yr - y) * 256 };
}
function loadDemTile(z, x, y) {
  const key = z + '/' + x + '/' + y;
  if (demCache.has(key)) return demCache.get(key);
  const pr = new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
        const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
        res(c.getImageData(0, 0, 256, 256).data);
      } catch (e) { rej(e); }
    };
    img.onerror = () => rej(new Error('tile ' + key));
    img.src = DEM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  });
  demCache.set(key, pr);
  pr.catch(() => demCache.delete(key));
  return pr;
}
function demElev(data, px, py) {
  const x = Math.max(0, Math.min(255, Math.floor(px))), y = Math.max(0, Math.min(255, Math.floor(py)));
  const i = (y * 256 + x) * 4;
  return (data[i] * 256 + data[i + 1] + data[i + 2] / 256) - 32768;
}
let demBusy = false;
function updateDemButtons() { document.querySelectorAll('[data-dem]').forEach(b => { b.disabled = demBusy; }); }
function demButton(scope) {
  const b = document.createElement('button'); b.className = 'btn btn-sm'; b.dataset.dem = scope; b.textContent = t('dem.btn');
  b.addEventListener('click', () => demApply(scope === 'sel' ? (selObj() ? [selObj()] : []) : state.net.nodes));
  return b;
}
async function demApply(nodes) {
  if (demBusy) return;
  if (!mapOn()) { toast(t('dem.needGeo'), 'err'); return; }
  const targets = nodes.filter(n => n.type === 'JUNCTION' || n.type === 'TANK');
  if (!targets.length) { toast(t('dem.noTarget'), 'err'); return; }
  demBusy = true; updateDemButtons();
  toast(t('dem.running'));
  try {
    let done = 0;
    for (const n of targets) {
      const [mx, my] = netToMerc(n.x, n.y);
      const tl = demTile(mxToLon(mx), myToLat(my), DEM_Z);
      const data = await loadDemTile(DEM_Z, tl.x, tl.y);
      n.elevation = Math.round(demElev(data, tl.px, tl.py) * 10) / 10;
      done++;
    }
    markDirty(false); render(); buildPropsForm();
    toast(t('dem.done', done), 'ok');
  } catch (e) { toast(t('dem.err') + e.message, 'err'); }
  finally { demBusy = false; updateDemButtons(); }
}

/* ============================ init ============================ */
async function init() {
  buildSettings(); renderElemList(); updateRunButton(); syncMapUI(); syncColorUI(); updateThemeBtn();
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