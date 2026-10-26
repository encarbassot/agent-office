/* Habbo-ish room — pixel graphics drawn by code. No external assets.
 * Everything here paints on a LOW-RES buffer (1 logical px = 1 canvas px);
 * main.js scales that buffer up by an integer factor (pixel-perfect).
 */
(function () {
  const HH = (window.HH = window.HH || {});

  // ---------- view / projection ----------
  // World units: 1 = one tile. z is in pixels (up).
  // Tile diamond = 32 x 16 px (classic 2:1 isometric).
  const view = { ox: 0, oy: 0 };
  HH.view = view;
  function P(wx, wy, wz = 0) {
    return [view.ox + (wx - wy) * 16, view.oy + (wx + wy) * 8 - wz];
  }
  HH.P = P;
  // inverse: logical px -> world (z = 0)
  HH.unproject = function (lx, ly) {
    const a = (lx - view.ox) / 16; // wx - wy
    const b = (ly - view.oy) / 8; // wx + wy
    return [(a + b) / 2, (b - a) / 2];
  };

  // ---------- raster primitives (crisp, no antialiasing) ----------
  function fillPoly(ctx, pts, color) {
    ctx.fillStyle = color;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    minY = Math.floor(minY); maxY = Math.ceil(maxY);
    for (let y = minY; y < maxY; y++) {
      const sy = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.round(xs[i]), x1 = Math.round(xs[i + 1]);
        if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1);
      }
    }
  }
  function line(ctx, x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    ctx.fillStyle = c;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function dot(ctx, p, c, w = 1, h = 1) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(p[0]), Math.round(p[1]), w, h);
  }
  HH.fillPoly = fillPoly; HH.line = line; HH.dot = dot;

  // shade a hex colour (-1..1)
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = k < 0 ? 0 : 255, f = Math.abs(k);
    r = Math.round(r + (t - r) * f); g = Math.round(g + (t - g) * f); b = Math.round(b + (t - b) * f);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  HH.shade = shade;

  // iso box: x,y in tiles, z,h in px. Faces: top, left (y+d plane), right (x+w plane).
  function box(ctx, x, y, z, w, d, h, color, opts = {}) {
    const top = opts.top || shade(color, 0.18);
    const left = opts.left || color;
    const right = opts.right || shade(color, -0.22);
    fillPoly(ctx, [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], left);
    fillPoly(ctx, [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], right);
    fillPoly(ctx, [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], top);
    if (opts.outline !== false) {
      const o = opts.outline || 'rgba(20,16,28,0.55)';
      const a = P(x, y, z + h), b = P(x + w, y, z + h), c = P(x + w, y + d, z + h), e = P(x, y + d, z + h);
      const bc = P(x + w, y + d, z), be = P(x, y + d, z), bb = P(x + w, y, z);
      line(ctx, a[0], a[1], b[0] - 1, b[1], o);
      line(ctx, a[0], a[1], e[0], e[1], o);
      line(ctx, e[0], e[1], be[0], be[1] - 1, o);
      line(ctx, b[0] - 1, b[1], bb[0] - 1, bb[1] - 1, o);
      line(ctx, be[0], be[1] - 1, bc[0] - 1, bc[1] - 1, o);
      line(ctx, bc[0] - 1, bc[1] - 1, bb[0] - 1, bb[1] - 1, o);
      // front-top edge highlight
      line(ctx, e[0] + 1, e[1], c[0] - 1, c[1], shade(top, 0.25));
    }
  }
  HH.box = box;

  // ---------- room shell ----------
  const PAL = {
    floorA: '#a7a27c', floorB: '#9f9a74', floorLine: '#8c8762',
    slab: '#7b7656', slabDark: '#625e43',
    wallR: '#c8ccd9', wallL: '#aeb2c3', wallCap: '#e6e8f0', wallEnd: '#8d91a3',
    hover: '#fff7c2',
  };
  HH.PAL = PAL;

  // points on a wall: R = the wall along y = 0 (a = x), L = the wall along x = 0 (a = y)
  const wp = (wall, a, z) => (wall === 'R' ? P(a, 0, z) : P(0, a, z));
  const wquad = (ctx, wall, a0, a1, z0, z1, c) => fillPoly(ctx, [wp(wall, a0, z0), wp(wall, a1, z0), wp(wall, a1, z1), wp(wall, a0, z1)], c);
  HH.wp = wp;
  // where a wall item sits on its wall: { a0, a1, z0, z1 } (some decos only have a point)
  HH.decoBounds = function (d) {
    if (d.kind === 'clock') return { a0: d.a0 - 0.35, a1: d.a0 + 0.35, z0: d.z0 - 7, z1: d.z0 + 7 };
    if (d.kind === 'shelf') return { a0: d.a0, a1: d.a1, z0: d.z0, z1: d.z0 + 7 };
    if (d.kind === 'chroma') return { a0: d.a0, a1: d.a1, z0: 0, z1: d.z1 + 2 };
    return { a0: d.a0, a1: d.a1 ?? d.a0 + 0.6, z0: d.z0, z1: d.z1 ?? d.z0 + 12 };
  };

  // deterministic noise for floors (no flicker frame to frame)
  const hash = (x, y, k = 0) => { let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; };

  function drawFloor(ctx, room, pal) {
    const { W, H } = room, st = room.floor || 'tiles';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c = (x + y) % 2 ? pal.floorA : pal.floorB;
      if (st === 'planks' || st === 'carpet' || st === 'straw' || st === 'steel' || st === 'stage') c = pal.floorA;
      fillPoly(ctx, [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], c);
      const a = P(x, y), b = P(x + 1, y), e = P(x, y + 1);
      if (st === 'tiles' || st === 'grid') {
        line(ctx, a[0], a[1], b[0] - 1, b[1], pal.floorLine);
        line(ctx, a[0] - 1, a[1], e[0], e[1], pal.floorLine);
      }
      if (st === 'grid') dot(ctx, P(x + 0.5, y + 0.5), shade(pal.floorA, -0.12), 2, 1);
      if (st === 'planks') { // boards along x, staggered seams
        for (let k = 0; k < 3; k++) { const p0 = P(x, y + k / 3), p1 = P(x + 1, y + k / 3); line(ctx, p0[0], p0[1], p1[0] - 1, p1[1], pal.floorLine); }
        const s = P(x + (hash(x, y) > 0.5 ? 0.3 : 0.7), y + 0.15); dot(ctx, s, pal.floorLine);
      }
      if (st === 'straw') for (let k = 0; k < 4; k++) {
        const p = P(x + hash(x, y, k), y + hash(y, x, k)); line(ctx, p[0], p[1], p[0] + 3, p[1] + (k % 2 ? 1 : -1), k % 2 ? pal.floorB : pal.floorLine);
      }
      if (st === 'steel') for (let k = 0; k < 4; k++) dot(ctx, P(x + 0.25 + (k % 2) * 0.5, y + 0.25 + (k >> 1) * 0.5), pal.floorLine, 2, 1);
      if (st === 'carpet' && hash(x, y) > 0.7) dot(ctx, P(x + 0.5, y + 0.5), pal.floorB, 2, 1);
      if (st === 'stage') { line(ctx, a[0], a[1], b[0] - 1, b[1], pal.floorLine); }
    }
  }

  HH.drawRoom = function (ctx, room, t) {
    const { W, H, WH } = room, T = 0.28, pal = { ...PAL, ...(room.pal || {}) };
    box(ctx, -T, -T, -7, W + T, H + T, 7, pal.slab, { left: pal.slab, right: pal.slabDark, top: pal.slab });
    drawFloor(ctx, room, pal);
    fillPoly(ctx, [P(0, 0), P(W, 0), P(W, 0, WH), P(0, 0, WH)], pal.wallR);
    fillPoly(ctx, [P(0, H), P(0, 0), P(0, 0, WH), P(0, H, WH)], pal.wallL);
    if (room.wallStyle === 'bricks' || room.wallStyle === 'barn') { // horizontal courses
      for (let z = 6; z < WH; z += room.wallStyle === 'barn' ? 9 : 5) {
        let a = P(0, 0, z), b = P(W, 0, z); line(ctx, a[0], a[1], b[0] - 1, b[1], shade(pal.wallR, -0.1));
        a = P(0, H, z); b = P(0, 0, z); line(ctx, a[0], a[1], b[0], b[1], shade(pal.wallL, -0.1));
      }
    }
    if (room.wallStyle === 'panels') { // vertical steel panels
      for (let x = 1; x < W; x++) { const a = P(x, 0, 4), b = P(x, 0, WH); line(ctx, a[0], a[1], b[0], b[1], shade(pal.wallR, -0.12)); }
      for (let y = 1; y < H; y++) { const a = P(0, y, 4), b = P(0, y, WH); line(ctx, a[0], a[1], b[0], b[1], shade(pal.wallL, -0.12)); }
    }
    fillPoly(ctx, [P(0, 0), P(W, 0), P(W, 0, 4), P(0, 0, 4)], shade(pal.wallR, -0.25));
    fillPoly(ctx, [P(0, H), P(0, 0), P(0, 0, 4), P(0, H, 4)], shade(pal.wallL, -0.25));
    fillPoly(ctx, [P(-T, -T, WH), P(W, -T, WH), P(W, 0, WH), P(0, 0, WH)], pal.wallCap);
    fillPoly(ctx, [P(-T, -T, WH), P(0, 0, WH), P(0, H, WH), P(-T, H, WH)], pal.wallCap);
    fillPoly(ctx, [P(W, -T, -7), P(W, 0, -7), P(W, 0, WH), P(W, -T, WH)], pal.wallEnd);
    fillPoly(ctx, [P(-T, H, -7), P(0, H, -7), P(0, H, WH), P(-T, H, WH)], shade(pal.wallEnd, 0.1));
    const c0 = P(0, 0), c1 = P(0, 0, WH);
    line(ctx, c0[0] - 1, c0[1], c1[0] - 1, c1[1], shade(pal.wallL, -0.12));
    for (const d of room.decos || []) (DECO[d.kind] || DECO.poster)(ctx, d, t, room);
    for (const d of room.doors || []) HH.drawDoor(ctx, d, t);
  };

  // ---------- doors ----------
  HH.DOOR_H = 40;
  HH.doorQuad = (d) => { const a0 = d.at + 0.12, a1 = d.at + 0.88; return [wp(d.wall, a0, 0), wp(d.wall, a1, 0), wp(d.wall, a1, HH.DOOR_H + 4), wp(d.wall, a0, HH.DOOR_H + 4)]; };
  HH.doorTile = (d) => (d.wall === 'R' ? [d.at, 0] : [0, d.at]);
  HH.drawDoor = function (ctx, d, t) {
    const a0 = d.at + 0.12, a1 = d.at + 0.88, h = HH.DOOR_H, frame = d.color || '#6b5a48';
    wquad(ctx, d.wall, a0 - 0.06, a1 + 0.06, 0, h + 3, shade(frame, -0.25));
    wquad(ctx, d.wall, a0, a1, 0, h + 1, frame);
    const open = d.openUntil && t < d.openUntil;
    wquad(ctx, d.wall, a0 + 0.08, a1 - 0.08, 0, h - 2, open ? '#fff3bf' : '#1c1a24');
    if (!open) { // panel lines + knob
      wquad(ctx, d.wall, a0 + 0.16, a1 - 0.16, 6, h - 22, shade(frame, -0.45));
      wquad(ctx, d.wall, a0 + 0.16, a1 - 0.16, h - 19, h - 6, shade(frame, -0.45));
      dot(ctx, wp(d.wall, d.wall === 'R' ? a1 - 0.18 : a0 + 0.18, 18), '#fcc419');
    } else {
      const m = wp(d.wall, (a0 + a1) / 2, 0); dot(ctx, [m[0] - 4, m[1] - 1], 'rgba(255,243,191,0.6)', 8, 2);
    }
    // plate above the door (emoji drawn by the overlay)
    wquad(ctx, d.wall, a0 + 0.05, a1 - 0.05, h + 6, h + 15, '#f8f9fa');
    wquad(ctx, d.wall, a0 + 0.05, a1 - 0.05, h + 6, h + 7, frame);
  };

  // ---------- wall decorations ----------
  const DECO = {
    poster(ctx, d) { // a bento poster
      const { wall, a0, a1, z0, z1 } = d;
      wquad(ctx, wall, a0 - 0.06, a1 + 0.06, z0 - 2, z1 + 2, '#2b2d42');
      wquad(ctx, wall, a0, a1, z0, z1, '#f8f9fa');
      const cells = [[0, 0, 0.5, 0.55, '#ff6b6b'], [0.5, 0, 0.5, 0.3, '#ffd43b'], [0.5, 0.3, 0.25, 0.25, '#4dabf7'], [0.75, 0.3, 0.25, 0.25, '#69db7c'], [0, 0.55, 0.3, 0.45, '#9775fa'], [0.3, 0.55, 0.7, 0.45, '#ffa94d']];
      const pw = a1 - a0, ph = z1 - z0, g = 0.06;
      for (const [u, v, w, h, c] of cells) wquad(ctx, wall, a0 + (u + g / 2) * pw, a0 + (u + w - g / 2) * pw, z1 - (v + h) * ph, z1 - (v + g) * ph, c);
    },
    window(ctx, d, t) {
      const { wall, a0, a1, z0, z1 } = d;
      wquad(ctx, wall, a0, a1, z0 - 2, z1 + 2, '#f1f2f6');
      wquad(ctx, wall, a0 + 0.1, a1 - 0.1, z0, z1, '#7cc4f2');
      wquad(ctx, wall, a0 + 0.1, a1 - 0.1, z0, z0 + 9, '#a6dbf7');
      for (let i = 0; i < 6; i++) { const yy = a0 + 0.2 + i * ((a1 - a0 - 0.4) / 6), hh = 4 + ((i * 7) % 9); wquad(ctx, wall, yy, yy + 0.2, z0, z0 + hh, '#5b7a99'); }
      const cl = wp(wall, a0 + 0.9 + Math.sin(t / 4000) * 0.2, z1 - 6);
      dot(ctx, [cl[0] - 3, cl[1]], '#ffffff', 7, 2); dot(ctx, [cl[0] - 1, cl[1] - 1], '#ffffff', 3, 1);
      const m = (a0 + a1) / 2;
      wquad(ctx, wall, m - 0.04, m + 0.04, z0, z1, '#f1f2f6');
      wquad(ctx, wall, a0, a1, (z0 + z1) / 2 - 1, (z0 + z1) / 2 + 1, '#f1f2f6');
    },
    clock(ctx, d) {
      const ck = wp(d.wall, d.a0, d.z0);
      fillPoly(ctx, [[ck[0] - 5, ck[1] - 3], [ck[0], ck[1] - 6], [ck[0] + 5, ck[1] - 3], [ck[0] + 5, ck[1] + 3], [ck[0], ck[1] + 6], [ck[0] - 5, ck[1] + 3]], '#343a40');
      fillPoly(ctx, [[ck[0] - 4, ck[1] - 2], [ck[0], ck[1] - 5], [ck[0] + 4, ck[1] - 2], [ck[0] + 4, ck[1] + 2], [ck[0], ck[1] + 5], [ck[0] - 4, ck[1] + 2]], '#fff9db');
      const dt = new Date(), ha = ((dt.getHours() % 12) / 12) * Math.PI * 2, ma = (dt.getMinutes() / 60) * Math.PI * 2;
      line(ctx, ck[0], ck[1], ck[0] + Math.sin(ha) * 2.5, ck[1] - Math.cos(ha) * 2.5, '#212529');
      line(ctx, ck[0], ck[1], ck[0] + Math.sin(ma) * 3.6, ck[1] - Math.cos(ma) * 3.6, '#c92a2a');
    },
    frame(ctx, d) { // small picture frame with a coloured square
      const { wall, a0, a1, z0, z1, color = '#4dabf7' } = d;
      wquad(ctx, wall, a0, a1, z0, z1, '#5c4433'); wquad(ctx, wall, a0 + 0.08, a1 - 0.08, z0 + 2, z1 - 2, color);
    },
    plans(ctx, d) { // whiteboard with the hydrate -> dehydrate diagram
      const { wall, a0, a1, z0, z1 } = d;
      wquad(ctx, wall, a0 - 0.05, a1 + 0.05, z0 - 2, z1 + 2, '#868e96'); wquad(ctx, wall, a0, a1, z0, z1, '#f8f9fa');
      const w = a1 - a0, zm = (z0 + z1) / 2;
      wquad(ctx, wall, a0 + w * 0.08, a0 + w * 0.32, zm - 4, zm + 4, '#1c7ed6');
      wquad(ctx, wall, a0 + w * 0.68, a0 + w * 0.92, zm - 4, zm + 4, '#e8590c');
      wquad(ctx, wall, a0 + w * 0.34, a0 + w * 0.66, zm - 0.5, zm + 0.5, '#212529');
      wquad(ctx, wall, a0 + w * 0.6, a0 + w * 0.66, zm - 2, zm + 2, '#212529');
      wquad(ctx, wall, a0 + w * 0.1, a0 + w * 0.9, z1 - 5, z1 - 4, '#adb5bd');
      wquad(ctx, wall, a0 + w * 0.1, a0 + w * 0.6, z0 + 3, z0 + 4, '#adb5bd');
    },
    chroma(ctx, d) { const { wall, a0, a1, z0, z1 } = d; wquad(ctx, wall, a0, a1, 0, z1, '#2fb344'); wquad(ctx, wall, a0, a1, z1, z1 + 2, '#212529'); },
    chart(ctx, d) { // bars going up
      const { wall, a0, a1, z0, z1 } = d, w = a1 - a0;
      wquad(ctx, wall, a0, a1, z0, z1, '#f8f9fa');
      [0.3, 0.45, 0.4, 0.65, 0.85].forEach((h, i) => wquad(ctx, wall, a0 + w * (0.1 + i * 0.17), a0 + w * (0.22 + i * 0.17), z0 + 2, z0 + 2 + (z1 - z0 - 5) * h, i === 4 ? '#2f9e44' : '#69db7c'));
      wquad(ctx, wall, a0 + w * 0.05, a1 - w * 0.05, z0 + 1, z0 + 2, '#495057');
    },
    calendar(ctx, d) {
      const { wall, a0, a1, z0, z1 } = d, w = a1 - a0;
      wquad(ctx, wall, a0, a1, z0, z1, '#ffffff'); wquad(ctx, wall, a0, a1, z1 - 4, z1, '#e03131');
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) wquad(ctx, wall, a0 + w * (0.1 + c * 0.22), a0 + w * (0.22 + c * 0.22), z0 + 2 + r * 4, z0 + 4 + r * 4, r === 1 && c === 2 ? '#e03131' : '#ced4da');
    },
    aircon(ctx, d, t) {
      const { wall, a0, a1, z0, z1 } = d;
      wquad(ctx, wall, a0, a1, z0, z1, '#e9ecef'); wquad(ctx, wall, a0 + 0.05, a1 - 0.05, z0 + 1, z0 + 3, '#adb5bd');
      const p = wp(wall, (a0 + a1) / 2, z0 - 2 - ((t / 90) % 6)); dot(ctx, p, 'rgba(165,216,255,0.7)', 3, 1);
      dot(ctx, wp(wall, a1 - 0.12, z1 - 2), Math.floor(t / 700) % 2 ? '#51cf66' : '#2b8a3e');
    },
    words(ctx, d) { // pinned papers with crossed-out headlines
      const { wall, a0, a1, z0, z1 } = d, w = a1 - a0;
      [[0, 0.45, 0.55, 1], [0.5, 1, 0.45, 0.95], [0.1, 0.55, 0, 0.42], [0.6, 0.95, 0.05, 0.4]].forEach(([u0, u1, v0, v1], i) => {
        const zz0 = z0 + (z1 - z0) * v0, zz1 = z0 + (z1 - z0) * v1;
        wquad(ctx, wall, a0 + w * u0, a0 + w * u1, zz0, zz1, i % 2 ? '#fff9db' : '#ffffff');
        wquad(ctx, wall, a0 + w * (u0 + 0.06), a0 + w * (u1 - 0.06), zz1 - 3, zz1 - 2, '#343a40');
        wquad(ctx, wall, a0 + w * (u0 + 0.04), a0 + w * (u1 - 0.04), zz1 - 3.5, zz1 - 2.5, i === 1 ? '#2f9e44' : '#e03131');
        dot(ctx, wp(wall, a0 + w * (u0 + u1) / 2, zz1), '#e03131');
      });
    },
    funnel(ctx, d) { // sales funnel on a whiteboard
      const { wall, a0, a1, z0, z1 } = d, w = a1 - a0, zh = z1 - z0;
      wquad(ctx, wall, a0 - 0.05, a1 + 0.05, z0 - 2, z1 + 2, '#868e96'); wquad(ctx, wall, a0, a1, z0, z1, '#f8f9fa');
      [['#4263eb', 0.1, 0.9], ['#748ffc', 0.22, 0.78], ['#bac8ff', 0.34, 0.66]].forEach(([c, u0, u1], i) => wquad(ctx, wall, a0 + w * u0, a0 + w * u1, z1 - zh * (0.12 + i * 0.28) - 6, z1 - zh * (0.12 + i * 0.28), c));
    },
    postits(ctx, d) { // wall of sticky notes
      const { wall, a0, a1, z0, z1 } = d, cols = ['#ffd43b', '#ff8787', '#74c0fc', '#8ce99a', '#ffa8a8', '#ffe066'];
      let k = 0;
      for (let z = z0; z < z1 - 4; z += 7) for (let a = a0; a < a1 - 0.25; a += 0.34) { wquad(ctx, wall, a, a + 0.26, z, z + 5, cols[k++ % cols.length]); }
    },
    tvwall(ctx, d, t) { // the bigScreen hanging on the wall, showing a landing
      const { wall, a0, a1, z0, z1 } = d, w = a1 - a0, zh = z1 - z0;
      wquad(ctx, wall, a0 - 0.05, a1 + 0.05, z0 - 2, z1 + 2, '#212529');
      wquad(ctx, wall, a0, a1, z0, z1, '#e7f5ff');
      wquad(ctx, wall, a0 + w * 0.1, a0 + w * 0.9, z1 - zh * 0.3, z1 - zh * 0.12, '#f06595');
      wquad(ctx, wall, a0 + w * 0.1, a0 + w * 0.48, z0 + zh * 0.15, z1 - zh * 0.4, '#ffd43b');
      wquad(ctx, wall, a0 + w * 0.52, a0 + w * 0.9, z0 + zh * 0.15, z1 - zh * 0.4, '#74c0fc');
      const sc = Math.floor(t / 900) % 3; wquad(ctx, wall, a0 + w * (0.15 + sc * 0.25), a0 + w * (0.25 + sc * 0.25), z0 + 2, z0 + 3, '#212529');
    },
    vault(ctx, d, t) { // round vault door
      const c = wp(d.wall, (d.a0 + d.a1) / 2, (d.z0 + d.z1) / 2), R = ((d.a1 - d.a0) * 16) / 2;
      const ring = (r, col) => { const pts = []; for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r * 1.1 + (d.wall === 'R' ? 1 : -1) * Math.cos(a) * r * 0.5]); } fillPoly(ctx, pts, col); };
      ring(R + 2, '#495057'); ring(R, '#adb5bd'); ring(R * 0.62, '#868e96'); ring(R * 0.2, '#343a40');
      for (let i = 0; i < 3; i++) { const a = t / 3000 + (i * Math.PI * 2) / 3; line(ctx, c[0], c[1], c[0] + Math.cos(a) * R * 0.55, c[1] + Math.sin(a) * R * 0.6, '#343a40'); }
    },
    cctv(ctx, d, t) { // 2x2 surveillance screens
      const { wall, a0, a1, z0, z1 } = d, w = a1 - a0, zh = z1 - z0;
      wquad(ctx, wall, a0, a1, z0, z1, '#212529');
      for (let i = 0; i < 4; i++) {
        const u = (i % 2) * 0.5, v = (i >> 1) * 0.5, on = Math.floor(t / 1700 + i) % 5 !== 0;
        wquad(ctx, wall, a0 + w * (u + 0.05), a0 + w * (u + 0.45), z0 + zh * (v + 0.08), z0 + zh * (v + 0.44), on ? '#2b8a3e' : '#0b2e13');
        if (on) dot(ctx, wp(wall, a0 + w * (u + 0.2 + ((t / 2000 + i) % 0.2)), z0 + zh * (v + 0.25)), '#b2f2bb');
      }
      dot(ctx, wp(wall, a1 - 0.1, z1 - 2), Math.floor(t / 500) % 2 ? '#ff6b6b' : '#5c1a1a');
    },
    registro(ctx, d) { // the public / private register sign
      const { wall, a0, a1, z0, z1 } = d, w = a1 - a0, zh = z1 - z0;
      wquad(ctx, wall, a0 - 0.05, a1 + 0.05, z0 - 2, z1 + 2, '#5c3d2e'); wquad(ctx, wall, a0, a1, z0, z1, '#fff9db');
      ['#c92a2a', '#2f9e44', '#f59f00'].forEach((c, i) => { const zz = z1 - 4 - i * (zh - 6) / 3; wquad(ctx, wall, a0 + w * 0.08, a0 + w * 0.2, zz - 3, zz, c); wquad(ctx, wall, a0 + w * 0.28, a0 + w * (0.88 - i * 0.12), zz - 2, zz - 1, '#495057'); });
    },
    shelf(ctx, d) { // a little wall shelf with jars / pots
      const { wall, a0, a1, z0 } = d;
      wquad(ctx, wall, a0, a1, z0, z0 + 2, '#8d6e4f');
      for (let a = a0 + 0.1; a < a1 - 0.15; a += 0.3) wquad(ctx, wall, a, a + 0.16, z0 + 2, z0 + 7, d.color || '#e8590c');
    },
    neon(ctx, d, t) { // text in neon tubes (d.text; d.split = where the second colour starts); the glow on top is painted at screen resolution (main.js)
      const { wall } = d, segs = HH.neonSegs(d), flick = neonFlicker(d, t);
      // dark acrylic board behind the tubes, so it reads on any wall
      wquad(ctx, wall, d.a0 - 0.22, d.a1 + 0.22, d.z0 - 1, d.z1 + 1, '#0b0a12');
      wquad(ctx, wall, d.a0 - 0.16, d.a1 + 0.16, d.z0, d.z1, '#17142a');
      for (const s of segs) {
        const on = !(flick >= 0 && s.ch === flick);
        if (on) wquad(ctx, wall, s.a0 - 0.06, s.a1 + 0.06, s.z0 - 1, s.z1 + 1, hexA(s.color, 0.35));
      }
      for (const s of segs) {
        const on = !(flick >= 0 && s.ch === flick);
        wquad(ctx, wall, s.a0, s.a1, s.z0, s.z1, on ? shade(s.color, 0.3) : shade(s.color, -0.6));
      }
    },
  };
  HH.DECO = DECO;

  // ---------- neon text (a tiny pixel font, 5 rows) ----------
  const GLYPH = {
    M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'], U: ['X..X', 'X..X', 'X..X', 'X..X', '.XX.'],
    R: ['XXX.', 'X..X', 'XXX.', 'X.X.', 'X..X'], A: ['.XX.', 'X..X', 'XXXX', 'X..X', 'X..X'],
    L: ['X...', 'X...', 'X...', 'X...', 'XXXX'], '.': ['.', '.', '.', '.', 'X'],
    I: ['XXX', '.X.', '.X.', '.X.', 'XXX'], N: ['X..X', 'XX.X', 'X.XX', 'X..X', 'X..X'],
    K: ['X..X', 'X.X.', 'XX..', 'X.X.', 'X..X'], ' ': ['..', '..', '..', '..', '..'],
    G: ['.XXX', 'X...', 'X.XX', 'X..X', '.XXX'], E: ['XXXX', 'X...', 'XXX.', 'X...', 'XXXX'], T: ['XXX', '.X.', '.X.', '.X.', '.X.'],
    O: ['.XX.', 'X..X', 'X..X', 'X..X', '.XX.'], F: ['XXXX', 'X...', 'XXX.', 'X...', 'X...'], C: ['.XXX', 'X...', 'X...', 'X...', '.XXX'],
  };
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  const NEON_PX = 2; // one glyph pixel = 2 x 2 logical px on the wall
  HH.neonWidth = (text) => [...text].reduce((s, ch) => s + ((GLYPH[ch] || GLYPH[' '])[0].length + 1) * NEON_PX, -NEON_PX) / 16;
  // the lit pixels as wall quads { a0, a1, z0, z1, color, ch }; on the L wall text runs the other way so it still reads left → right
  HH.neonSegs = function (d) {
    const text = d.text || 'AGENT OFFICE', split = d.split ?? text.indexOf('.'), out = [], step = NEON_PX / 16;
    let col = 0;
    [...text].forEach((ch, i) => {
      const g = GLYPH[ch] || GLYPH[' '], color = split >= 0 && i >= split ? d.color2 || '#4df3ff' : d.color || '#ff5cf0';
      g.forEach((row, r) => [...row].forEach((c, k) => {
        if (c !== 'X') return;
        const u = (col + k) * step, z1 = d.z1 - 2 - r * NEON_PX;
        const a0 = d.wall === 'L' ? d.a1 - u - step : d.a0 + u;
        out.push({ a0, a1: a0 + step, z0: z1 - NEON_PX, z1, color, ch: i });
      }));
      col += g[0].length + 1;
    });
    return out;
  };
  // every ~6 s one letter (the K by default) stutters for a moment, like a real tube
  function neonFlicker(d, t) {
    const ph = (t + (d.seed || 0)) % 6000;
    if (ph > 5600 && Math.floor(ph / 70) % 2) return d.flicker ?? (d.text || 'AGENT OFFICE').length - 1;
    return -1;
  }
  HH.neonFlicker = neonFlicker;
  HH.drawTileHighlight = function (ctx, x, y, color) {
    const a = P(x, y), b = P(x + 1, y), c = P(x + 1, y + 1), e = P(x, y + 1);
    line(ctx, a[0], a[1], b[0] - 1, b[1], color);
    line(ctx, b[0] - 1, b[1], c[0], c[1] - 1, color);
    line(ctx, c[0], c[1] - 1, e[0], e[1], color);
    line(ctx, e[0], e[1], a[0] - 1, a[1], color);
  };

  // ---------- floor decorations (drawn under everything) ----------
  HH.drawRug = function (ctx, f, t) {
    const { x, y, w, d } = f, st = f.style || 'heart';
    if (st === 'tape') { // stage marks: an X and a T in gaffer tape
      const m = (u, v) => P(x + u * w, y + v * d), c = '#fcc419';
      let a = m(0.3, 0.3), b = m(0.7, 0.7); line(ctx, a[0], a[1], b[0], b[1], c); a = m(0.7, 0.3); b = m(0.3, 0.7); line(ctx, a[0], a[1], b[0], b[1], c);
      return;
    }
    if (st === 'cables') { // cable runs on the floor
      ['#339af0', '#fcc419', '#f03e3e'].forEach((c, i) => { const a = P(x + 0.1, y + 0.3 + i * 0.15), b = P(x + w - 0.1, y + 0.3 + i * 0.15); line(ctx, a[0], a[1], b[0], b[1], c); });
      return;
    }
    if (st === 'mat') { // felpudo: coir with a dark border and a bell (tap it to call people)
      fillPoly(ctx, [P(x + 0.08, y + 0.12), P(x + w - 0.08, y + 0.12), P(x + w - 0.08, y + d - 0.12), P(x + 0.08, y + d - 0.12)], '#5c3d2e');
      fillPoly(ctx, [P(x + 0.16, y + 0.2), P(x + w - 0.16, y + 0.2), P(x + w - 0.16, y + d - 0.2), P(x + 0.16, y + d - 0.2)], '#c8955c');
      for (let k = 1; k < 4; k++) { const a = P(x + 0.2, y + 0.2 + k * 0.15 * d), b = P(x + w - 0.2, y + 0.2 + k * 0.15 * d); line(ctx, a[0], a[1], b[0] - 1, b[1], '#b07e49'); }
      const c = P(x + w / 2, y + d / 2), ring = Math.floor(t / 1800) % 4 === 0 ? 1 : 0;
      dot(ctx, [c[0] - 2, c[1] - 3 - ring], '#fcc419', 5, 3); dot(ctx, [c[0] - 3, c[1] - ring], '#fcc419', 7, 1); dot(ctx, [c[0], c[1] + 1 - ring], '#e8a317', 1, 1);
      return;
    }
    const c1 = f.color || '#c2255c', c2 = f.color2 || '#f06595';
    fillPoly(ctx, [P(x + 0.1, y + 0.1), P(x + w - 0.1, y + 0.1), P(x + w - 0.1, y + d - 0.1), P(x + 0.1, y + d - 0.1)], c1);
    fillPoly(ctx, [P(x + 0.3, y + 0.3), P(x + w - 0.3, y + 0.3), P(x + w - 0.3, y + d - 0.3), P(x + 0.3, y + d - 0.3)], c2);
    if (st !== 'heart') return;
    const c = P(x + w / 2, y + d / 2);
    const heart = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
    heart.forEach((row, j) => [...row].forEach((ch, i) => ch === 'X' && dot(ctx, [c[0] - 7 + i * 2, c[1] - 6 + j * 2], '#fff0f6', 2, 2)));
  };

  // ---------- furniture ----------
  // Each drawer gets (ctx, f, t). f = {x, y, w, d, ...}
  // Seats: `flip` puts the backrest on the near side (the seat faces the wall); back(f)(v, len) maps a depth offset.
  const back = (f) => (v, len) => (f.flip ? (f.d || 1) - v - len : v);
  const FURNI = {
    desk(ctx, f, t) { // drafting desk with blueprints and bricks
      const { x, y } = f, wood = '#8d6e4f';
      for (const [u, v] of [[0.1, 0.1], [1.8, 0.1], [0.1, 0.78], [1.8, 0.78]]) box(ctx, x + u, y + v, 0, 0.1, 0.1, 14, '#5c4433', { outline: false });
      box(ctx, x, y, 14, 2, 1, 3, wood);
      // blueprint sheet
      fillPoly(ctx, [P(x + 0.15, y + 0.15, 17), P(x + 1.25, y + 0.15, 17), P(x + 1.25, y + 0.85, 17), P(x + 0.15, y + 0.85, 17)], '#1c7ed6');
      for (let i = 1; i < 4; i++) { const a = P(x + 0.2 + i * 0.25, y + 0.25, 17), b = P(x + 0.2 + i * 0.25, y + 0.75, 17); line(ctx, a[0], a[1], b[0], b[1], '#a5d8ff'); }
      { const a = P(x + 0.25, y + 0.5, 17), b = P(x + 1.15, y + 0.5, 17); line(ctx, a[0], a[1], b[0], b[1], '#e7f5ff'); }
      // bricks
      box(ctx, x + 1.4, y + 0.2, 17, 0.45, 0.25, 4, '#c0532c');
      box(ctx, x + 1.4, y + 0.5, 17, 0.45, 0.25, 4, '#b04a26');
      box(ctx, x + 1.45, y + 0.35, 21, 0.45, 0.25, 4, '#d0643a');
      // mug
      box(ctx, x + 1.1, y + 0.6, 17, 0.15, 0.15, 4, '#f1f3f5');
    },
    rack(ctx, f, t) { // server rack with blinking LEDs and cables
      const { x, y } = f;
      box(ctx, x + 0.05, y + 0.1, 0, 0.9, 0.8, 54, '#343a40', { left: '#2b2f33', right: '#1f2326', top: '#495057' });
      for (let r = 0; r < 9; r++) {
        const z = 6 + r * 5.3;
        const a = P(x + 0.12, y + 0.9, z), b = P(x + 0.88, y + 0.9, z);
        line(ctx, a[0], a[1], b[0], b[1], '#15181b');
        for (let k = 0; k < 4; k++) {
          const on = Math.sin(t / (150 + r * 37 + k * 53) + r * 3 + k) > 0.1, dv = f._dev;
          // f._dev (main.js): undefined = just a decoration · null = no device on this rack · { up } = a real one
          let col = k === 3 ? (on ? '#ff922b' : '#5c3a18') : on ? '#51cf66' : '#1f4d27';
          if (dv === null) col = '#1f2326';
          else if (dv && !dv.up) col = k === 0 && r % 3 === 0 && Math.floor(t / 600) % 2 ? '#ff3b3b' : '#3d1414';
          dot(ctx, P(x + 0.2 + k * 0.12, y + 0.9, z + 2.5), col);
        }
      }
      if (f._dev !== undefined) { // status lamp on top: green up, red down, grey empty
        const lamp = f._dev ? (f._dev.up ? '#51cf66' : Math.floor(t / 500) % 2 ? '#ff3b3b' : '#8a1c1c') : '#495057';
        box(ctx, x + 0.38, y + 0.38, 54, 0.24, 0.24, 3, lamp, { outline: false });
      }
      // cables to the floor
      const cols = ['#339af0', '#fcc419', '#f03e3e', '#ffffff'];
      cols.forEach((c, i) => {
        const a = P(x + 0.7 + i * 0.05, y + 0.92, 20 + i * 6), b = P(x + 0.95 + i * 0.1, y + 1.05 + i * 0.12, 0);
        const m = [(a[0] + b[0]) / 2 + 3, (a[1] + b[1]) / 2 + 4];
        line(ctx, a[0], a[1], m[0], m[1], c); line(ctx, m[0], m[1], b[0], b[1], c);
      });
    },
    camera(ctx, f, t) { // camera on a tripod with REC light
      const { x, y } = f, top = P(x + 0.5, y + 0.5, 30);
      for (const [u, v] of [[0.15, 0.3], [0.85, 0.4], [0.5, 0.9]]) { const b = P(x + u, y + v, 0); line(ctx, top[0], top[1], b[0], b[1], '#212529'); }
      box(ctx, x + 0.3, y + 0.35, 30, 0.4, 0.3, 9, '#212529', { top: '#495057' });
      box(ctx, x + 0.45, y + 0.62, 33, 0.12, 0.25, 4, '#343a40'); // lens
      dot(ctx, P(x + 0.52, y + 0.86, 35), '#74c0fc');
      if (Math.floor(t / 600) % 2) dot(ctx, P(x + 0.35, y + 0.35, 38), '#ff1f1f', 2, 1);
    },
    ringlight(ctx, f, t) {
      const { x, y } = f, b = P(x + 0.5, y + 0.5, 0), tp = P(x + 0.5, y + 0.5, 34);
      box(ctx, x + 0.35, y + 0.35, 0, 0.3, 0.3, 2, '#212529', { outline: false });
      line(ctx, b[0], b[1], tp[0], tp[1], '#495057');
      const glow = 0.75 + Math.sin(t / 500) * 0.25;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        dot(ctx, [tp[0] + Math.cos(a) * 6, tp[1] - 6 + Math.sin(a) * 7], glow > 0.8 ? '#fffbe6' : '#fff3bf', 1, 1);
      }
    },
    ledger(ctx, f, t) { // desk with cash register and coins
      const { x, y } = f;
      box(ctx, x + 0.05, y + 0.05, 0, 0.9, 0.9, 16, '#495057', { top: '#868e96' });
      box(ctx, x + 0.15, y + 0.2, 16, 0.5, 0.5, 7, '#2f9e44', { top: '#51cf66' }); // register
      box(ctx, x + 0.2, y + 0.25, 23, 0.3, 0.12, 4, '#1b1b1b'); // screen
      dot(ctx, P(x + 0.32, y + 0.37, 25), '#8ce99a', 3, 1);
      for (let i = 0; i < 4; i++) box(ctx, x + 0.72, y + 0.55, 16 + i * 2, 0.16, 0.16, 2, i % 2 ? '#f59f00' : '#fcc419', { outline: false });
      // € sign floating over it every so often
      if (Math.floor(t / 2200) % 3 === 0) { const e = P(x + 0.5, y + 0.5, 40 + ((t / 30) % 8)); dot(ctx, [e[0] - 1, e[1]], '#2f9e44', 3, 1); dot(ctx, [e[0] - 2, e[1] - 2], '#2f9e44', 1, 5); dot(ctx, [e[0] - 1, e[1] - 3], '#2f9e44', 3, 1); dot(ctx, [e[0] - 1, e[1] + 2], '#2f9e44', 3, 1); }
    },
    easel(ctx, f, t) { // easel with a canvas of words
      const { x, y } = f;
      const a = P(x + 0.2, y + 0.7, 0), b = P(x + 0.8, y + 0.7, 0), c = P(x + 0.5, y + 0.2, 0), tp = P(x + 0.5, y + 0.55, 40);
      line(ctx, a[0], a[1], tp[0], tp[1], '#8d6e4f'); line(ctx, b[0], b[1], tp[0], tp[1], '#8d6e4f'); line(ctx, c[0], c[1], tp[0], tp[1], '#6b5136');
      fillPoly(ctx, [P(x + 0.1, y + 0.62, 14), P(x + 0.9, y + 0.62, 14), P(x + 0.9, y + 0.62, 38), P(x + 0.1, y + 0.62, 38)], '#fffdf5');
      fillPoly(ctx, [P(x + 0.1, y + 0.62, 13), P(x + 0.9, y + 0.62, 13), P(x + 0.9, y + 0.62, 14), P(x + 0.1, y + 0.62, 14)], '#6b5136');
      // "Aa" scribbles + red underline
      const o = P(x + 0.18, y + 0.62, 34);
      ['#212529', '#212529', '#868e96'].forEach((c2, i) => dot(ctx, [o[0] + 2, o[1] + 1 + i * 4], c2, 9 - i * 2, 2));
      dot(ctx, [o[0] + 2, o[1] + 13], '#e03131', 10, 1);
    },
    sofa(ctx, f, t) { // velvet sofa
      const { x, y } = f, c = '#7048e8', v = back(f);
      box(ctx, x + 0.05, y + v(0.15, 0.8), 0, 1.9, 0.8, 9, c);
      box(ctx, x + 0.05, y + v(0.1, 0.25), 9, 1.9, 0.25, 11, shade(c, -0.1)); // backrest
      box(ctx, x + 0.05, y + v(0.35, 0.6), 9, 0.25, 0.6, 5, shade(c, 0.05)); // armrest
      box(ctx, x + 1.7, y + v(0.35, 0.6), 9, 0.25, 0.6, 5, shade(c, 0.05));
      box(ctx, x + 0.65, y + v(0.4, 0.45), 9, 0.5, 0.45, 2, '#ffd43b', { outline: false }); // cushion
    },
    plant(ctx, f, t) {
      const { x, y } = f;
      box(ctx, x + 0.3, y + 0.3, 0, 0.4, 0.4, 9, '#c0532c');
      const c = P(x + 0.5, y + 0.5, 9), sw = Math.round(Math.sin(t / 900 + x) * 1);
      const leaves = [[-5, -6], [4, -8], [-2, -13], [3, -15], [-6, -11], [6, -12], [0, -18], [-3, -4], [5, -4]];
      leaves.forEach(([dx, dy], i) => (!f.dry || i % 3) && dot(ctx, [c[0] + dx + (dy < -10 ? sw : 0), c[1] + dy], f.dry ? (i % 2 ? '#a07f2a' : '#7c8a3a') : i % 2 ? '#2f9e44' : '#40c057', 4, 3));
    },
    safe(ctx, f, t) { // old steel safe
      const { x, y } = f;
      box(ctx, x + 0.1, y + 0.1, 0, 0.8, 0.8, 24, '#5c677d', { top: '#8d99ae' });
      fillPoly(ctx, [P(x + 0.2, y + 0.9, 4), P(x + 0.8, y + 0.9, 4), P(x + 0.8, y + 0.9, 20), P(x + 0.2, y + 0.9, 20)], '#4a5568');
      const dl = P(x + 0.45, y + 0.9, 13);
      dot(ctx, [dl[0] - 2, dl[1] - 2], '#d9dee6', 4, 4); dot(ctx, [dl[0] - 1, dl[1] - 1], '#343a40', 2, 2);
      const hd = P(x + 0.7, y + 0.9, 12); dot(ctx, [hd[0], hd[1] - 3], '#d9dee6', 1, 6);
      // a padlock key-light
      dot(ctx, P(x + 0.3, y + 0.9, 18), Math.floor(t / 1500) % 2 ? '#ff6b6b' : '#c92a2a');
    },
    armchair(ctx, f, t) {
      const { x, y } = f, c = '#a0522d', v = back(f);
      box(ctx, x + 0.1, y + v(0.15, 0.75), 0, 0.8, 0.75, 8, c);
      box(ctx, x + 0.1, y + v(0.1, 0.22), 8, 0.8, 0.22, 12, shade(c, -0.1));
      box(ctx, x + 0.1, y + v(0.3, 0.6), 8, 0.15, 0.6, 5, shade(c, 0.08));
      box(ctx, x + 0.75, y + v(0.3, 0.6), 8, 0.15, 0.6, 5, shade(c, 0.08));
    },
    pedestal(ctx, f, t) { // golden egg on a pedestal
      const { x, y } = f;
      box(ctx, x + 0.2, y + 0.2, 0, 0.6, 0.6, 3, '#dee2e6');
      box(ctx, x + 0.28, y + 0.28, 3, 0.44, 0.44, 14, '#f8f9fa', { top: '#ffffff' });
      box(ctx, x + 0.2, y + 0.2, 17, 0.6, 0.6, 2, '#dee2e6');
      const c = P(x + 0.5, y + 0.5, 19 + Math.round(Math.sin(t / 700)));
      const egg = ['..XXX..', '.XXXXX.', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'];
      egg.forEach((row, j) => [...row].forEach((ch, i) => ch === 'X' && dot(ctx, [c[0] - 3 + i, c[1] - 9 + j], j < 3 ? '#ffe066' : j > 5 ? '#e8a317' : '#fcc419')));
      dot(ctx, [c[0] - 1, c[1] - 7], '#fffbe6', 1, 2);
      if (Math.floor(t / 400) % 5 === 0) { dot(ctx, [c[0] + 4, c[1] - 11], '#ffffff'); dot(ctx, [c[0] + 3, c[1] - 12], '#fff3bf', 3, 1); dot(ctx, [c[0] + 4, c[1] - 13], '#fff3bf', 1, 3); }
    },
    table(ctx, f, t) { // coffee table in the middle
      const { x, y } = f;
      box(ctx, x + 0.45, y + 0.45, 0, 0.1, 0.1, 8, '#343a40', { outline: false });
      box(ctx, x + 0.1, y + 0.1, 8, 0.8, 0.8, 2, '#e9ecef');
      box(ctx, x + 0.3, y + 0.35, 10, 0.15, 0.15, 4, '#f1f3f5'); // cup
      dot(ctx, P(x + 0.4, y + 0.42, 15 + ((t / 200) % 4)), 'rgba(255,255,255,0.7)');
    },
  };
  // ---------- more furniture ----------
  Object.assign(FURNI, {
    bigtable(ctx, f, t) { // the round-ish meeting table
      const { x, y, w, d } = f;
      for (const [u, v] of [[0.4, 0.4], [w - 0.5, 0.4], [0.4, d - 0.5], [w - 0.5, d - 0.5]]) box(ctx, x + u, y + v, 0, 0.1, 0.1, 12, '#5c4433', { outline: false });
      box(ctx, x + 0.15, y + 0.15, 12, w - 0.3, d - 0.3, 3, '#a0714f', { top: '#c08a5e' });
      fillPoly(ctx, [P(x + 0.5, y + 0.5, 15), P(x + w - 0.5, y + 0.5, 15), P(x + w - 0.5, y + d - 0.5, 15), P(x + 0.5, y + d - 0.5, 15)], '#b07e55');
      // papers, mugs and the golden egg postcard
      box(ctx, x + 0.6, y + 0.6, 15, 0.12, 0.12, 4, '#f1f3f5');
      box(ctx, x + w - 0.8, y + d - 0.8, 15, 0.12, 0.12, 4, '#ffd43b');
      fillPoly(ctx, [P(x + 1.1, y + 0.7, 15), P(x + 1.6, y + 0.7, 15), P(x + 1.6, y + 1.1, 15), P(x + 1.1, y + 1.1, 15)], '#f8f9fa');
      fillPoly(ctx, [P(x + w / 2 - 0.2, y + d / 2 - 0.1, 15), P(x + w / 2 + 0.3, y + d / 2 - 0.1, 15), P(x + w / 2 + 0.3, y + d / 2 + 0.25, 15), P(x + w / 2 - 0.2, y + d / 2 + 0.25, 15)], '#1c7ed6');
    },
    tubes(ctx, f) { // rack of rolled blueprints
      const { x, y } = f;
      box(ctx, x + 0.15, y + 0.15, 0, 0.7, 0.7, 14, '#8d6e4f', { top: '#6b5136' });
      for (let i = 0; i < 6; i++) { const u = 0.25 + (i % 3) * 0.2, v = 0.3 + (i >> 1 & 1) * 0.3; box(ctx, x + u, y + v, 10, 0.1, 0.1, 14 + (i * 5) % 9, i % 2 ? '#a5d8ff' : '#e7f5ff', { outline: false }); }
    },
    bricks(ctx, f) { // a pallet of bricks
      const { x, y } = f;
      box(ctx, x + 0.08, y + 0.08, 0, 0.84, 0.84, 3, '#a07f5a');
      for (let r = 0; r < 3; r++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) box(ctx, x + 0.12 + i * 0.4, y + 0.12 + j * 0.4, 3 + r * 4, 0.36, 0.36, 4, (r + i + j) % 2 ? '#c0532c' : '#b04a26');
    },
    lamp(ctx, f, t) { // floor lamp
      const { x, y } = f, b = P(x + 0.5, y + 0.5, 0), tp = P(x + 0.5, y + 0.5, 34);
      box(ctx, x + 0.38, y + 0.38, 0, 0.24, 0.24, 2, '#343a40', { outline: false });
      line(ctx, b[0], b[1], tp[0], tp[1], '#495057');
      box(ctx, x + 0.3, y + 0.3, 32, 0.4, 0.4, 7, f.color || '#ffe066', { top: '#fff3bf' });
      dot(ctx, [tp[0] - 4, tp[1] + 3], 'rgba(255,243,191,0.5)', 8, 1);
    },
    spot(ctx, f, t) { // big studio spotlight
      const { x, y } = f, b = P(x + 0.5, y + 0.5, 0), tp = P(x + 0.5, y + 0.5, 30);
      for (const [u, v] of [[0.2, 0.3], [0.8, 0.4], [0.5, 0.85]]) { const q = P(x + u, y + v, 0); line(ctx, tp[0], tp[1], q[0], q[1], '#212529'); }
      box(ctx, x + 0.25, y + 0.25, 28, 0.5, 0.5, 10, '#343a40', { top: '#495057' });
      const on = 0.7 + Math.sin(t / 700) * 0.3;
      fillPoly(ctx, [P(x + 0.3, y + 0.75, 30), P(x + 0.7, y + 0.75, 30), P(x + 0.7, y + 0.75, 36), P(x + 0.3, y + 0.75, 36)], on > 0.6 ? '#fff9db' : '#ffec99');
    },
    dirchair(ctx, f) { // director's chair
      const { x, y } = f, b = back(f);
      for (const [u, v] of [[0.2, 0.25], [0.75, 0.25], [0.2, 0.75], [0.75, 0.75]]) box(ctx, x + u, y + v, 0, 0.06, 0.06, 10, '#6b4423', { outline: false });
      box(ctx, x + 0.2, y + 0.25, 10, 0.6, 0.55, 1, '#e64980', { outline: false });
      box(ctx, x + 0.2, y + b(0.2, 0.08), 14, 0.6, 0.08, 7, '#e64980');
      dot(ctx, P(x + 0.4, y + b(0.2, 0.08) + (f.flip ? 0.08 : 0), 18), '#ffffff', 4, 1);
    },
    filing(ctx, f) { // filing cabinet
      const { x, y } = f;
      box(ctx, x + 0.15, y + 0.15, 0, 0.7, 0.7, 30, '#868e96', { top: '#adb5bd' });
      for (let i = 0; i < 3; i++) { const z = 4 + i * 9; fillPoly(ctx, [P(x + 0.22, y + 0.85, z), P(x + 0.78, y + 0.85, z), P(x + 0.78, y + 0.85, z + 7), P(x + 0.22, y + 0.85, z + 7)], '#748089'); dot(ctx, P(x + 0.48, y + 0.85, z + 4), '#dee2e6', 3, 1); }
      box(ctx, x + 0.3, y + 0.3, 30, 0.35, 0.25, 3, '#fff9db', { outline: false });
    },
    bookshelf(ctx, f) { // tall bookshelf
      const { x, y } = f, cols = ['#c92a2a', '#1971c2', '#2f9e44', '#f08c00', '#7048e8', '#e8590c', '#0c8599'];
      box(ctx, x + 0.1, y + 0.2, 0, 0.8, 0.65, 46, '#6b5136', { top: '#8d6e4f' });
      for (let s = 0; s < 4; s++) {
        const z = 4 + s * 11;
        fillPoly(ctx, [P(x + 0.15, y + 0.85, z), P(x + 0.85, y + 0.85, z), P(x + 0.85, y + 0.85, z + 9), P(x + 0.15, y + 0.85, z + 9)], '#3d2c1e');
        for (let k = 0; k < 6; k++) { const u = 0.18 + k * 0.11, hh = 6 + ((s * 3 + k * 5) % 3); fillPoly(ctx, [P(x + u, y + 0.85, z), P(x + u + 0.08, y + 0.85, z), P(x + u + 0.08, y + 0.85, z + hh), P(x + u, y + 0.85, z + hh)], cols[(s * 2 + k) % cols.length]); }
      }
    },
    side(ctx, f, t) { // small table with something on it
      const { x, y } = f;
      box(ctx, x + 0.45, y + 0.45, 0, 0.1, 0.1, 10, '#343a40', { outline: false });
      box(ctx, x + 0.1, y + 0.1, 10, 0.8, 0.8, 2, f.color || '#e9ecef');
      const z = 12, it = f.item || 'cup';
      if (it === 'cup') { box(ctx, x + 0.3, y + 0.35, z, 0.15, 0.15, 4, '#f1f3f5'); dot(ctx, P(x + 0.4, y + 0.42, z + 5 + ((t / 200) % 4)), 'rgba(255,255,255,0.7)'); }
      if (it === 'typewriter') { box(ctx, x + 0.2, y + 0.25, z, 0.55, 0.45, 4, '#343a40', { top: '#495057' }); box(ctx, x + 0.25, y + 0.25, z + 4, 0.45, 0.08, 6, '#fffdf5', { outline: false }); box(ctx, x + 0.72, y + 0.6, z, 0.12, 0.12, 4, '#f1f3f5'); }
      if (it === 'phone') { box(ctx, x + 0.3, y + 0.3, z, 0.35, 0.3, 3, '#c92a2a', { top: '#e03131' }); box(ctx, x + 0.28, y + 0.3, z + 3, 0.4, 0.1, 2, '#212529'); if (Math.floor(t / 300) % 14 < 3) { const p = P(x + 0.5, y + 0.4, z + 10); dot(ctx, [p[0] - 3, p[1]], '#212529', 1, 2); dot(ctx, [p[0] + 3, p[1]], '#212529', 1, 2); } }
      if (it === 'laptop') { box(ctx, x + 0.2, y + 0.3, z, 0.5, 0.4, 1, '#adb5bd'); fillPoly(ctx, [P(x + 0.2, y + 0.3, z + 1), P(x + 0.7, y + 0.3, z + 1), P(x + 0.7, y + 0.3, z + 9), P(x + 0.2, y + 0.3, z + 9)], '#212529'); dot(ctx, P(x + 0.3, y + 0.3, z + 6), Math.floor(t / 600) % 2 ? '#51cf66' : '#212529', 3, 1); }
      if (it === 'notebook') HH.drawNotebook(ctx, x + 0.28, y + 0.3, z, f);
      if (it === 'tablet') { fillPoly(ctx, [P(x + 0.25, y + 0.25, z), P(x + 0.7, y + 0.25, z), P(x + 0.7, y + 0.6, z), P(x + 0.25, y + 0.6, z)], '#212529'); fillPoly(ctx, [P(x + 0.3, y + 0.3, z), P(x + 0.65, y + 0.3, z), P(x + 0.65, y + 0.55, z), P(x + 0.3, y + 0.55, z)], '#74c0fc'); box(ctx, x + 0.72, y + 0.62, z, 0.1, 0.16, 1, '#343a40', { outline: false }); }
    },
    trophies(ctx, f, t) { // shelf of trophies
      const { x, y } = f;
      box(ctx, x + 0.1, y + 0.2, 0, 0.8, 0.6, 30, '#2b2f36', { top: '#495057' });
      for (let s = 0; s < 2; s++) for (let k = 0; k < 3; k++) {
        const u = 0.22 + k * 0.22, z = 8 + s * 12, c = (s + k) % 3 === 0 ? '#adb5bd' : '#fcc419';
        box(ctx, x + u, y + 0.65, z, 0.12, 0.12, 2, '#495057', { outline: false });
        box(ctx, x + u - 0.02, y + 0.63, z + 2, 0.16, 0.16, 5, c, { outline: false });
        if (Math.floor(t / 500 + k + s) % 9 === 0) dot(ctx, P(x + u + 0.05, y + 0.7, z + 9), '#ffffff');
      }
    },
    lockers(ctx, f) { // steel lockers with padlocks
      const { x, y } = f;
      box(ctx, x + 0.1, y + 0.15, 0, 0.8, 0.7, 40, '#5c677d', { top: '#8d99ae' });
      for (let k = 0; k < 2; k++) {
        const u0 = 0.16 + k * 0.38, u1 = u0 + 0.32;
        fillPoly(ctx, [P(x + u0, y + 0.85, 3), P(x + u1, y + 0.85, 3), P(x + u1, y + 0.85, 37), P(x + u0, y + 0.85, 37)], '#4a5568');
        for (let v = 0; v < 3; v++) dot(ctx, P(x + u0 + 0.06, y + 0.85, 30 - v * 2), '#2d3748', 4, 1);
        dot(ctx, P(x + u1 - 0.08, y + 0.85, 20), '#fcc419', 2, 3);
      }
    },
    hay(ctx, f) { // hay bale
      const { x, y } = f;
      box(ctx, x + 0.08, y + 0.15, 0, 0.84, 0.7, 12, '#e0b84c', { top: '#f2d16b', right: '#c79a2e' });
      for (let k = 0; k < 3; k++) { const a = P(x + 0.15 + k * 0.3, y + 0.85, 2), b = P(x + 0.2 + k * 0.3, y + 0.85, 10); line(ctx, a[0], a[1], b[0], b[1], '#b08a2a'); }
      const s = P(x + 0.3, y + 0.15, 12); line(ctx, s[0], s[1], s[0] + 6, s[1] - 2, '#c8a13a');
    },
    nest(ctx, f, t) { // straw nest with eggs
      const { x, y } = f;
      box(ctx, x + 0.2, y + 0.2, 0, 0.6, 0.6, 4, '#b08a2a', { top: '#d9ad45' });
      const c = P(x + 0.5, y + 0.5, 4);
      dot(ctx, [c[0] - 4, c[1] - 3], '#fff9db', 3, 3); dot(ctx, [c[0], c[1] - 4], '#fff9db', 3, 3);
      dot(ctx, [c[0] + 3, c[1] - 2], f.gold ? '#fcc419' : '#fff9db', 3, 3);
    },
    fence(ctx, f) { // low wooden fence along x
      const { x, y, w } = f;
      for (let i = 0; i <= w * 2; i++) box(ctx, x + i * 0.5 - 0.04, y + 0.45, 0, 0.08, 0.08, 12, '#8d6e4f', { outline: false });
      box(ctx, x, y + 0.45, 8, w, 0.06, 2, '#a07f5a', { outline: false });
      box(ctx, x, y + 0.45, 3, w, 0.06, 2, '#a07f5a', { outline: false });
    },
    hen(ctx, f, t) { // the hen (pecks around its little patch)
      const ph = t / 2600 + f.x, u = 0.5 + Math.sin(ph) * 0.35, v = 0.5 + Math.cos(ph * 0.7) * 0.35;
      const c = P(f.x + u, f.y + v, 0), left = Math.cos(ph) > 0, peck = Math.floor(t / 250) % 6 === 0;
      const s = left ? -1 : 1, px = (dx, dy, col, w = 1, h = 1) => dot(ctx, [c[0] + s * dx - (s < 0 ? w - 1 : 0), c[1] + dy], col, w, h);
      ctx.fillStyle = 'rgba(30,24,20,0.25)'; ctx.fillRect(c[0] - 4, c[1], 8, 1);
      px(-4, -7, '#1a1420', 8, 6); px(-3, -6, '#ffffff', 6, 4); px(-4, -9, '#ffffff', 3, 3); // body + tail
      px(2, peck ? -6 : -10, '#ffffff', 3, 4); px(3, peck ? -7 : -11, '#e03131', 2, 1); px(5, peck ? -5 : -9, '#f59f00', 1, 1); px(3, peck ? -5 : -9, '#1a1420');
      px(-1, -2, '#f59f00', 1, 2); px(1, -2, '#f59f00', 1, 2);
    },
    chair(ctx, f) { // simple office chair
      const { x, y } = f, c = f.color || '#343a40', v = back(f);
      box(ctx, x + 0.45, y + 0.45, 0, 0.1, 0.1, 7, '#868e96', { outline: false });
      box(ctx, x + 0.25, y + 0.25, 7, 0.5, 0.5, 2, c);
      box(ctx, x + 0.25, y + v(0.2, 0.1), 9, 0.5, 0.1, 9, shade(c, -0.1));
    },
    aircon_floor(ctx, f, t) { // in-row cooling unit
      const { x, y } = f;
      box(ctx, x + 0.05, y + 0.1, 0, 0.9, 0.8, 50, '#ced4da', { top: '#e9ecef' });
      for (let r = 0; r < 8; r++) { const z = 8 + r * 4; const a = P(x + 0.15, y + 0.9, z), b = P(x + 0.85, y + 0.9, z); line(ctx, a[0], a[1], b[0], b[1], '#868e96'); }
      dot(ctx, P(x + 0.7, y + 0.9, 44), Math.floor(t / 900) % 2 ? '#339af0' : '#1864ab', 2, 1);
    },
  });
  // ---------- the work desk: a monitor that faces the chair (+y; turned, +x). f._on (main.js) = someone typing ----------
  Object.assign(FURNI, {
    workdesk(ctx, f, t) {
      const { x, y } = f, z = 13, wood = f.color || '#6b5136', top = z + 2;
      for (const [u, v] of [[0.1, 0.12], [0.84, 0.12], [0.1, 0.82], [0.84, 0.82]]) box(ctx, x + u, y + v, 0, 0.07, 0.07, z, shade(wood, -0.3), { outline: false });
      box(ctx, x + 0.04, y + 0.06, z, 0.92, 0.86, 2, wood, { top: shade(wood, 0.18) });
      if (f.item === 'plans') fillPoly(ctx, [P(x + 0.06, y + 0.55, top), P(x + 0.4, y + 0.55, top), P(x + 0.4, y + 0.85, top), P(x + 0.06, y + 0.85, top)], '#1c7ed6');
      box(ctx, x + 0.46, y + 0.2, top, 0.08, 0.06, 4, '#212529', { outline: false }); // stand
      box(ctx, x + 0.16, y + 0.16, top + 4, 0.68, 0.08, 13, '#1a1420', { outline: false }); // monitor
      const Fy = y + 0.24, sq = (u0, u1, z0, z1, c) => fillPoly(ctx, [P(x + u0, Fy, top + z0), P(x + u1, Fy, top + z0), P(x + u1, Fy, top + z1), P(x + u0, Fy, top + z1)], c);
      if (f._on) { // code scrolling up the screen
        sq(0.2, 0.8, 5, 16, '#0d1b2a');
        const k = Math.floor(t / 170), cols = ['#69db7c', '#4dabf7', '#ffd43b', '#ff8787', '#e9ecef', '#b197fc'];
        for (let i = 0; i < 5; i++) { const n = (k + i) * 7, w = 0.12 + ((n * 13) % 7) / 18, ind = ((n * 5) % 3) * 0.05; sq(0.23 + ind, Math.min(0.77, 0.23 + ind + w), 14 - i * 2, 15 - i * 2, cols[n % cols.length]); }
        if (Math.floor(t / 400) % 2) sq(0.23, 0.27, 5.5, 6.5, '#ffffff');
      } else { sq(0.2, 0.8, 5, 16, '#25262b'); sq(0.46, 0.54, 10, 11, '#3b3d45'); }
      box(ctx, x + 0.22, y + 0.52, top, 0.46, 0.15, 1, '#ced4da', { outline: false }); // keyboard
      dot(ctx, P(x + 0.78, y + 0.6, top + 1), '#adb5bd', 2, 1); // mouse
      if (f.mug !== false) box(ctx, x + 0.82, y + 0.28, top, 0.1, 0.1, 3, '#f1f3f5', { outline: false });
      if (f.notebook) HH.drawNotebook(ctx, x + 0.06, y + 0.48, top, f);
    },
  });

  // ---------- the retro arcade machine (lobby). Front = the y + d face, side art on the x + w face ----------
  Object.assign(FURNI, {
    arcade(ctx, f, t) {
      const { x, y } = f, body = f.color || '#2b2d6e', Fy = y + 0.84, Sx = x + 0.82;
      box(ctx, x + 0.18, y + 0.12, 0, 0.64, 0.72, 48, body, { left: shade(body, -0.08), right: shade(body, -0.32), top: shade(body, 0.2) });
      const q = (u0, u1, z0, z1, c) => fillPoly(ctx, [P(x + u0, Fy, z0), P(x + u1, Fy, z0), P(x + u1, Fy, z1), P(x + u0, Fy, z1)], c);
      const side = (v0, v1, z0, z1, c) => fillPoly(ctx, [P(Sx, y + v0, z0), P(Sx, y + v1, z0), P(Sx, y + v1, z1), P(Sx, y + v0, z1)], c);
      // side art: two neon stripes
      side(0.16, 0.8, 30, 32, '#ff5cf0'); side(0.16, 0.8, 26, 27, '#4df3ff'); side(0.16, 0.8, 4, 6, '#fcc419');
      // marquee, lit
      const lit = Math.floor(t / 450) % 3 !== 0;
      q(0.2, 0.8, 41, 47, lit ? '#ff5cf0' : '#c2255c');
      for (let i = 0; i < 6; i++) dot(ctx, P(x + 0.27 + i * 0.09, Fy, 45), lit ? '#fff0f6' : '#ffdeeb', 2, 1);
      // screen: a little invaders game
      q(0.22, 0.78, 24, 39, '#0b0a12'); q(0.26, 0.74, 26, 37, '#0d1b2a');
      const sw = Math.sin(t / 700) * 0.05;
      for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) dot(ctx, P(x + 0.32 + i * 0.1 + sw, Fy, 35 - r * 3), r ? '#69db7c' : '#ff922b', 2, 1);
      const ship = 0.5 + Math.sin(t / 900) * 0.16;
      dot(ctx, P(x + ship - 0.03, Fy, 27.5), '#4df3ff', 3, 1);
      const shot = (t / 60) % 12;
      if (shot < 8) dot(ctx, P(x + ship, Fy, 28.5 + shot), '#fff3bf');
      if (Math.floor(t / 900) % 4 === 0) for (let i = 0; i < 4; i++) dot(ctx, P(x + 0.33 + i * 0.1, Fy, 31), '#ffffff'); // «INSERT COIN» blink
      // control panel sticking out, joystick and two buttons
      box(ctx, x + 0.2, y + 0.84, 18, 0.6, 0.14, 3, shade(body, 0.12), { outline: false });
      { const a = P(x + 0.34, y + 0.9, 21), b = P(x + 0.34, y + 0.9, 25 + Math.round(Math.sin(t / 300))); line(ctx, a[0], a[1], b[0], b[1], '#212529'); dot(ctx, [b[0] - 1, b[1] - 1], '#e03131', 2, 2); }
      dot(ctx, P(x + 0.56, y + 0.92, 21), '#fcc419', 2, 1); dot(ctx, P(x + 0.68, y + 0.92, 21), '#4dabf7', 2, 1);
      // coin door
      q(0.38, 0.62, 5, 13, shade(body, -0.35));
      dot(ctx, P(x + 0.45, Fy, 10), Math.floor(t / 700) % 2 ? '#fcc419' : '#8a6a00', 1, 2); dot(ctx, P(x + 0.55, Fy, 10), '#fcc419', 1, 2);
    },
  });

  // ---------- startup corner (lobby): ping-pong, futbolín, billar ----------
  // All three are 2 x 1 tiles, long side along x.
  const legs = (ctx, x, y, w, d, h, c) => { for (const [u, v] of [[0.12, 0.12], [w - 0.2, 0.12], [0.12, d - 0.2], [w - 0.2, d - 0.2]]) box(ctx, x + u, y + v, 0, 0.08, 0.08, h, c, { outline: false }); };
  Object.assign(FURNI, {
    pingpong(ctx, f, t) {
      const { x, y } = f, z = 13;
      legs(ctx, x, y, 2, 1, z, '#343a40');
      box(ctx, x + 0.05, y + 0.08, z, 1.9, 0.84, 2, '#1864ab', { top: '#1c7ed6' });
      const lt = (u0, v0, u1, v1) => { const a = P(x + u0, y + v0, z + 2), b = P(x + u1, y + v1, z + 2); line(ctx, a[0], a[1], b[0], b[1], '#e7f5ff'); };
      lt(0.1, 0.13, 1.9, 0.13); lt(0.1, 0.87, 1.9, 0.87); lt(0.1, 0.13, 0.1, 0.87); lt(1.9, 0.13, 1.9, 0.87); lt(0.1, 0.5, 1.9, 0.5);
      // net across the middle
      fillPoly(ctx, [P(x + 1, y + 0.02, z + 2), P(x + 1, y + 0.98, z + 2), P(x + 1, y + 0.98, z + 6), P(x + 1, y + 0.02, z + 6)], 'rgba(248,249,250,0.75)');
      { const a = P(x + 1, y + 0.02, z + 6), b = P(x + 1, y + 0.98, z + 6); line(ctx, a[0], a[1], b[0], b[1], '#ffffff'); }
      // paddles resting on each half
      box(ctx, x + 0.35, y + 0.55, z + 2, 0.22, 0.2, 1, '#e03131', { outline: false });
      box(ctx, x + 1.45, y + 0.25, z + 2, 0.22, 0.2, 1, '#212529', { outline: false });
      // the ball rallies end to end
      const ph = (t / 900) % 2, u = ph < 1 ? ph : 2 - ph, hop = Math.abs(Math.sin(u * Math.PI * 2)) * 9;
      const bp = P(x + 0.25 + u * 1.5, y + 0.45 + Math.sin(t / 700) * 0.18, z + 3 + hop);
      dot(ctx, [bp[0] - 1, bp[1] - 1], '#fff4e6', 2, 2);
      dot(ctx, P(x + 0.25 + u * 1.5, y + 0.45 + Math.sin(t / 700) * 0.18, z + 2), 'rgba(0,0,0,0.25)', 2, 1);
    },
    futbolin(ctx, f, t) {
      const { x, y } = f, z = 8, wood = '#8d5a3b';
      legs(ctx, x, y, 2, 1, z, '#3d2c1e');
      box(ctx, x + 0.08, y + 0.12, z, 1.84, 0.76, 9, wood, { top: '#a86b45' });
      fillPoly(ctx, [P(x + 0.18, y + 0.2, z + 9), P(x + 1.82, y + 0.2, z + 9), P(x + 1.82, y + 0.8, z + 9), P(x + 0.18, y + 0.8, z + 9)], '#2f9e44');
      { const a = P(x + 1, y + 0.2, z + 9), b = P(x + 1, y + 0.8, z + 9); line(ctx, a[0], a[1], b[0], b[1], '#d3f9d8'); }
      dot(ctx, P(x + 1, y + 0.5, z + 9), '#d3f9d8', 2, 1);
      // rods across the field, with the little players and the handles sticking out
      const rods = [0.35, 0.6, 0.85, 1.15, 1.4, 1.65], ph = Math.sin(t / 400);
      rods.forEach((u, i) => {
        const red = i % 2 === 0, slide = red ? ph * 0.06 : -ph * 0.06;
        const a = P(x + u, y - 0.05, z + 12), b = P(x + u, y + 1.12, z + 12);
        line(ctx, a[0], a[1], b[0], b[1], '#ced4da');
        const hdl = P(x + u, y + 1.12, z + 12); dot(ctx, [hdl[0] - 1, hdl[1] - 1], '#212529', 2, 2);
        for (let k = 0; k < (i === 0 || i === 5 ? 1 : 2); k++) {
          const v = (i === 0 || i === 5 ? 0.5 : 0.35 + k * 0.3) + slide, p = P(x + u, y + v, z + 9);
          dot(ctx, [p[0] - 1, p[1] - 5], red ? '#e03131' : '#1c7ed6', 2, 4);
          dot(ctx, [p[0] - 1, p[1] - 6], '#ffd8a8', 2, 1);
        }
      });
      const bu = 1 + Math.sin(t / 650) * 0.6, bp = P(x + bu, y + 0.5 + Math.cos(t / 530) * 0.2, z + 9);
      dot(ctx, [bp[0], bp[1] - 1], '#ffffff', 1, 1);
    },
    billar(ctx, f, t) {
      const { x, y } = f, z = 11, wood = '#5c3a21';
      box(ctx, x + 0.2, y + 0.25, 0, 0.18, 0.5, z, '#3d2617', { outline: false });
      box(ctx, x + 1.62, y + 0.25, 0, 0.18, 0.5, z, '#3d2617', { outline: false });
      box(ctx, x + 0.04, y + 0.06, z, 1.92, 0.88, 4, wood, { top: '#7a4e2d' });
      fillPoly(ctx, [P(x + 0.14, y + 0.16, z + 4), P(x + 1.86, y + 0.16, z + 4), P(x + 1.86, y + 0.84, z + 4), P(x + 0.14, y + 0.84, z + 4)], '#2b8a3e');
      for (const [u, v] of [[0.16, 0.18], [1, 0.16], [1.84, 0.18], [0.16, 0.82], [1, 0.84], [1.84, 0.82]]) dot(ctx, P(x + u, y + v, z + 4), '#111111', 2, 1);
      // a rack of balls and the white one
      const balls = [['#fcc419', 1.35, 0.5], ['#e03131', 1.45, 0.44], ['#1c7ed6', 1.45, 0.56], ['#212529', 1.55, 0.5], ['#7048e8', 1.55, 0.38], ['#e8590c', 1.55, 0.62]];
      for (const [c, u, v] of balls) dot(ctx, P(x + u, y + v, z + 5), c, 2, 2);
      const roll = Math.floor(t / 4000) % 2 ? 0.55 : 0.5 + Math.sin(t / 300) * 0.04;
      dot(ctx, P(x + roll, y + 0.5, z + 5), '#f8f9fa', 2, 2);
      // the cue lying across
      { const a = P(x + 0.2, y + 0.72, z + 6), b = P(x + 1.1, y + 0.62, z + 6); line(ctx, a[0], a[1], b[0], b[1], '#e9c46a'); dot(ctx, a, '#3d2617', 2, 1); }
    },
  });
  Object.assign(FURNI, {
    bossdesk(ctx, f, t) { // the boss desk: screen with a bento, keyboard, mug, and a notebook
      const { x, y } = f, z = 14, wood = f.color || '#3b2a20';
      box(ctx, x + 0.08, y + 0.15, 0, 0.3, 0.7, z, shade(wood, -0.1));
      box(ctx, x + 1.62, y + 0.15, 0, 0.3, 0.7, z, shade(wood, -0.1));
      box(ctx, x + 0.38, y + 0.18, 3, 1.24, 0.08, z - 3, shade(wood, -0.25), { outline: false }); // modesty panel
      box(ctx, x + 0.02, y + 0.08, z, 1.96, 0.86, 3, wood, { top: shade(wood, 0.15) });
      const top = z + 3;
      box(ctx, x + 0.9, y + 0.3, top, 0.12, 0.12, 6, '#212529', { outline: false }); // monitor stand
      fillPoly(ctx, [P(x + 0.45, y + 0.3, top + 5), P(x + 1.45, y + 0.3, top + 5), P(x + 1.45, y + 0.3, top + 20), P(x + 0.45, y + 0.3, top + 20)], '#1a1420');
      const scr = (u0, u1, z0, z1, c) => fillPoly(ctx, [P(x + u0, y + 0.3, top + z0), P(x + u1, y + 0.3, top + z0), P(x + u1, y + 0.3, top + z1), P(x + u0, y + 0.3, top + z1)], c);
      scr(0.5, 1.4, 6, 19, '#e7f5ff');
      scr(0.55, 0.85, 12, 18, '#ff6b6b'); scr(0.9, 1.35, 15, 18, '#ffd43b'); scr(0.9, 1.1, 7, 14, '#4dabf7'); scr(1.15, 1.35, 7, 14, '#69db7c'); scr(0.55, 0.85, 7, 11, '#9775fa');
      if (Math.floor(t / 530) % 2) scr(1.17, 1.2, 9, 12, '#212529'); // blinking cursor
      box(ctx, x + 0.6, y + 0.55, top, 0.7, 0.18, 1, '#ced4da', { outline: false }); // keyboard
      box(ctx, x + 1.6, y + 0.55, top, 0.14, 0.14, 4, '#f1f3f5');
      dot(ctx, P(x + 1.67, y + 0.6, top + 5 + ((t / 200) % 4)), 'rgba(255,255,255,0.7)');
      if (f.notebook) HH.drawNotebook(ctx, x + 0.12, y + 0.42, top, f);
    },
  });
  // a closed notebook with an elastic band; the cover takes its owner's colour
  HH.drawNotebook = function (ctx, x, y, z, f) {
    const owner = f.notebook && f.notebook !== (HH.PLAYER && HH.PLAYER.id) && HH.byId ? HH.byId(f.notebook) : null;
    const cover = f.cover || (owner && owner.accent) || '#2f9e44';
    box(ctx, x, y, z, 0.42, 0.34, 2, '#f8f9fa', { outline: false }); // pages
    box(ctx, x - 0.02, y - 0.02, z + 2, 0.46, 0.38, 1, cover, { top: shade(cover, 0.1) });
    { const a = P(x + 0.33, y - 0.02, z + 3), b = P(x + 0.33, y + 0.36, z + 3); line(ctx, a[0], a[1], b[0], b[1], '#1a1420'); }
    dot(ctx, P(x + 0.12, y + 0.12, z + 3), '#fff3bf', 2, 1);
  };
  HH.drawFurni = function (ctx, f, t) { (FURNI[f.type] || FURNI.plant)(ctx, f, t); };
  HH.FURNI = FURNI;

  // ---------- avatars (procedural pixel sprites) ----------
  // ---------- legs: poses as pixel templates, shared by every avatar ----------
  // Each pose = rows of letters from (x, y) on the 26 × 42 sprite. The letters are colour roles, not colours:
  //   P trousers · p trousers in shade (far leg) · q far shin, a bit darker · S shoes · s shoes, far one
  // so any avatar reuses them with its own `look` (HH.drawLegs(put, pose, colours)). Facing: screen right / towards
  // the viewer; the renderer mirrors it for the other side. Hips are row 29 (main.js puts that on a seat).
  const rep = (row, n) => Array(n).fill(row);
  HH.LEGS = {
    stand: { x: 8, y: 29, rows: [...rep('..PPPppp', 8), '.SSSSssss', '.SSSSssss'] },
    walk1: { x: 8, y: 29, rows: [...rep('..PPPppp', 7), '.SSSSppp', '.SSSSssss', '.....ssss'] },  // near leg lifted
    walk3: { x: 8, y: 29, rows: [...rep('..PPPppp', 7), '..PPPssss', '.SSSSssss', '.SSSS'] },     // far leg lifted
    // sitting, knees at 90°: thighs level going forward, shins straight down, toes forward
    sit: { x: 8, y: 29, rows: [...rep('..ppppppppp', 2), ...rep('.PPPPPPPPPPP', 2), ...rep('..........qPP', 4), ...rep('..........sPPs', 2), ...rep('...........SSSS', 2)] },
    // sitting with the back to us: the seat of the trousers, the far thigh just showing past the hip
    sitBack: { x: 8, y: 29, rows: [...rep('.PPPPPPPPpp', 2), '.PPPPPPPP'] },
  };
  HH.drawLegs = function (put, pose, colours) {
    const L = HH.LEGS[pose] || HH.LEGS.stand;
    L.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = colours[row[i]]; if (c) put(L.x + i, L.y + j, 1, 1, c); } });
  };

  // the crash-test dummy: agents with no soul (Explore, general-purpose, a Claude session…)
  HH.DUMMY_LOOK = { skin: '#f5c400', hair: 'bald', hairColor: '#d6a800', shirt: '#f5c400', sleeve: '#f5c400', pants: '#e8b800', shoes: '#16161a', extras: ['dummy'] };

  const SW = 26, SH = 42; // sprite box; feet at y = 38, centre x = 13
  HH.SPRITE = { W: SW, H: SH, footY: 39 };
  const OUT = '#1a1420';

  function makeAvatar(look, view, frame) {
    const g = new Array(SW * SH).fill(null);
    const r = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const X = x + i, Y = y + j; if (X >= 0 && X < SW && Y >= 0 && Y < SH) g[Y * SW + X] = c; } };
    const px = (x, y, c) => r(x, y, 1, 1, c);
    const ex = new Set(look.extras || []);
    const front = view === 'front';
    const skin = look.skin, skinD = shade(skin, -0.18), hc = look.hairColor;
    const shirt = look.shirt, shirtD = shade(shirt, -0.2), pants = look.pants, pantsD = shade(pants, -0.25);
    const shoes = look.shoes || '#2b2b2b';
    const bob = frame === 1 || frame === 3 ? -1 : 0;

    // legs: a pose from HH.LEGS, painted with this avatar's colours (see below)
    const typing = frame === 'k0' || frame === 'k1', sitting = frame === 's' || typing;
    const pose = sitting ? (front ? 'sit' : 'sitBack') : frame === 1 ? 'walk1' : frame === 3 ? 'walk3' : 'stand';
    HH.drawLegs(r, pose, { P: pants, p: pantsD, q: shade(pantsD, -0.06), S: shoes, s: shade(shoes, 0.1) });
    if (ex.has('apron')) r(9, 27, 8, 5, '#fff');

    const u = bob; // upper body offset
    // arms behind/at sides
    const la = typing ? (frame === 'k0' ? -1 : 0) : frame === 1 ? 1 : frame === 3 ? -1 : 0, ra = typing ? (frame === 'k1' ? -1 : 0) : -la;
    const armL = typing ? 6 : 8; // typing: forearms go forward to the keyboard, so the arm we see is shorter
    const sleeve = look.sleeve || shirt;
    r(7, 20 + u + la, 2, armL, shade(sleeve, -0.05)); if (!typing) r(7, 28 + u + la, 2, 2, skin);
    r(17, 20 + u + ra, 2, armL, shade(sleeve, -0.12)); if (!typing) r(17, 28 + u + ra, 2, 2, skinD);
    // torso
    r(9, 19 + u, 8, 11, shirt); r(15, 19 + u, 2, 11, shirtD);
    r(9, 29 + u, 8, 1, shade(pants, -0.1)); // belt line
    // neck + head
    r(12, 18 + u, 2, 1, skinD);
    r(8, 7 + u, 10, 11, skin);
    px(8, 7 + u, null); px(17, 7 + u, null); px(8, 17 + u, null); px(17, 17 + u, null);
    r(16, 8 + u, 2, 9, skinD);

    if (front) {
      // ear, eyes, mouth (facing down-right)
      r(8, 12 + u, 1, 2, skinD);
      if (!ex.has('dummy')) { r(12, 12 + u, 1, 2, '#1b1b1b'); r(15, 12 + u, 1, 2, '#1b1b1b'); }
      if (ex.has('dummy')) { /* no face */ } else if (ex.has('smile')) { r(13, 15 + u, 3, 1, '#9c3b2f'); px(12, 14 + u, '#9c3b2f'); px(16, 14 + u, '#9c3b2f'); }
      else r(13, 15 + u, 2, 1, '#9c4a3a');
      if (ex.has('blush')) { px(11, 14 + u, '#ff8fa3'); px(16, 14 + u, '#ff8fa3'); }
      if (ex.has('frown')) { r(11, 10 + u, 2, 1, hc); px(13, 11 + u, hc); r(15, 10 + u, 2, 1, hc); px(14, 11 + u, hc); }
    }

    // hair
    const hs = look.hair;
    if (front) {
      if (hs === 'short') { r(8, 5 + u, 10, 3, hc); r(8, 8 + u, 2, 4, hc); px(10, 8 + u, hc); }
      if (hs === 'messy') { r(8, 5 + u, 10, 3, hc); r(8, 8 + u, 2, 4, hc); r(10, 8 + u, 3, 1, hc); px(9, 4 + u, hc); px(12, 4 + u, hc); px(15, 4 + u, hc); px(17, 5 + u, hc); }
      if (hs === 'long') { r(7, 5 + u, 11, 3, hc); r(7, 8 + u, 3, 13, hc); r(17, 8 + u, 2, 8, hc); px(10, 8 + u, hc); }
      if (hs === 'bun') { r(8, 5 + u, 10, 3, hc); r(8, 8 + u, 2, 4, hc); r(11, 2 + u, 4, 3, hc); px(12, 1 + u, hc); px(13, 1 + u, hc); }
      if (hs === 'curly') { r(7, 4 + u, 12, 4, hc); r(7, 8 + u, 2, 6, hc); r(17, 8 + u, 2, 5, hc); [9, 12, 15].forEach((cx) => px(cx, 3 + u, hc)); px(9, 8 + u, hc); px(6, 9 + u, hc); px(19, 10 + u, hc); }
      if (hs === 'slick') { r(8, 5 + u, 10, 2, hc); r(11, 4 + u, 7, 1, hc); r(8, 7 + u, 2, 4, hc); px(17, 7 + u, hc); }
      if (hs === 'ponytail') { r(8, 5 + u, 10, 3, hc); r(8, 8 + u, 2, 4, hc); r(6, 8 + u, 2, 8, hc); px(7, 7 + u, hc); }
      if (hs === 'bald') { r(8, 9 + u, 1, 4, hc); r(9, 9 + u, 1, 2, hc); px(11, 6 + u, shade(skin, 0.3)); }
    } else {
      if (hs === 'short' || hs === 'messy') { r(8, 5 + u, 10, 10, hc); if (hs === 'messy') { px(9, 4 + u, hc); px(13, 4 + u, hc); px(16, 4 + u, hc); } }
      if (hs === 'long') { r(7, 5 + u, 12, 16, hc); }
      if (hs === 'bun') { r(8, 5 + u, 10, 10, hc); r(11, 2 + u, 4, 3, hc); }
      if (hs === 'curly') { r(7, 4 + u, 12, 12, hc); [9, 12, 15].forEach((cx) => px(cx, 3 + u, hc)); }
      if (hs === 'slick') { r(8, 5 + u, 10, 9, hc); }
      if (hs === 'ponytail') { r(8, 5 + u, 10, 10, hc); r(12, 15 + u, 2, 7, hc); }
      if (hs === 'bald') { r(8, 10 + u, 10, 4, hc); }
      r(16, 11 + u, 1, 2, skinD); // ear
    }

    // facial hair
    if (front && ex.has('beard')) { r(11, 14 + u, 7, 4, hc); r(13, 15 + u, 2, 1, '#7a3b2e'); }
    if (front && ex.has('mustache')) r(12, 14 + u, 5, 1, hc);
    if (front && ex.has('glasses')) { r(11, 11 + u, 3, 3, '#7a2e2e'); px(12, 12 + u, '#1b1b1b'); r(14, 11 + u, 3, 3, '#7a2e2e'); px(15, 12 + u, '#1b1b1b'); }

    // hats
    if (look.hat === 'hardhat') { r(8, 3 + u, 10, 4, '#fab005'); r(7, 7 + u, 12, 1, '#f08c00'); r(12, 2 + u, 2, 1, '#fab005'); px(10, 4 + u, '#ffe066'); }
    if (look.hat === 'boina') { r(7, 4 + u, 12, 3, '#2b2f36'); r(6, 6 + u, 13, 1, '#2b2f36'); r(8, 3 + u, 8, 1, '#2b2f36'); px(12, 2 + u, '#2b2f36'); px(9, 4 + u, '#495057'); }
    if (look.hat === 'visor') { r(8, 6 + u, 10, 1, '#2f9e44'); r(front ? 12 : 6, 7 + u, 7, 1, '#51cf66'); }
    if (look.hat === 'hood') { r(7, 4 + u, 12, 2, shade(shirt, 0.08)); r(7, 6 + u, 1, 12, shade(shirt, 0.08)); r(18, 6 + u, 1, 12, shade(shirt, -0.1)); }

    // crash-test dummy: black-and-yellow quadrant targets on the head and the chest, black joints
    if (ex.has('dummy')) {
      const K = '#16161a', Y = skin;
      const target = (x, y) => { r(x, y, 2, 2, K); r(x + 2, y + 2, 2, 2, K); r(x + 2, y, 2, 2, Y); r(x, y + 2, 2, 2, Y); px(x, y, null); px(x + 3, y + 3, null); };
      target(front ? 12 : 10, 9 + u);
      if (front) target(11, 22 + u);
      r(12, 18 + u, 2, 1, K); r(9, 28 + u, 8, 1, K); // neck and hip joints
      r(7, 24 + u + la, 2, 1, K); r(17, 24 + u + ra, 2, 1, K); // elbows
    }

    // torso extras
    if (ex.has('tie') && front) { r(12, 19 + u, 2, 1, '#fff'); r(12, 20 + u, 2, 6, '#e03131'); px(12, 26 + u, '#c92a2a'); }
    if (ex.has('heart') && front) { const h = ['X.X', 'XXX', '.X.']; h.forEach((row, j) => [...row].forEach((ch, i) => ch === 'X' && px(11 + i, 22 + j + u, '#ffffff'))); }
    if (ex.has('scarf')) { r(9, 18 + u, 8, 2, '#e8a317'); if (front) r(10, 20 + u, 2, 5, '#e8a317'); }
    if (ex.has('hoodie') && front) { r(11, 23 + u, 1, 3, '#51cf66'); r(14, 23 + u, 1, 3, '#51cf66'); px(12, 24 + u, '#51cf66'); px(13, 24 + u, '#51cf66'); r(12, 19 + u, 1, 3, '#dee2e6'); r(14, 19 + u, 1, 3, '#dee2e6'); }
    if (ex.has('cardigan')) { r(12, 19 + u, 2, 10, shade(shirt, 0.25)); [21, 24, 27].forEach((yy) => px(12, yy + u, '#212529')); }
    if (ex.has('headset')) { r(7, 9 + u, 1, 4, '#212529'); r(8, 5 + u, 1, 4, '#212529'); if (front) { r(9, 14 + u, 3, 1, '#212529'); px(11, 15 + u, '#ff6b6b'); } }

    // props in hand (screen right)
    const hy = 28 + u + ra;
    if (ex.has('blueprint')) { r(17, 22 + u, 7, 2, '#228be6'); px(23, 22 + u, '#a5d8ff'); px(17, 23 + u, '#1864ab'); }
    if (ex.has('clapper')) { r(18, hy - 5, 6, 2, '#f8f9fa'); px(19, hy - 5, '#212529'); px(21, hy - 5, '#212529'); px(23, hy - 4, '#212529'); r(18, hy - 3, 6, 4, '#212529'); r(19, hy - 2, 4, 1, '#f8f9fa'); }
    if (ex.has('calc')) { r(18, hy - 3, 4, 5, '#868e96'); r(19, hy - 2, 2, 1, '#b2f2bb'); px(19, hy, '#f8f9fa'); px(20, hy + 1, '#f8f9fa'); }
    if (ex.has('cables')) {
      r(9, 18 + u, 8, 1, '#339af0');
      r(19, hy, 1, 8, '#339af0'); r(20, hy + 1, 1, 6, '#fcc419'); r(18, hy + 2, 1, 7, '#f03e3e');
      px(19, hy + 8, '#e9ecef'); px(20, hy + 7, '#e9ecef'); px(18, hy + 9, '#e9ecef');
    }
    if (ex.has('pen')) { r(19, hy - 6, 1, 6, '#212529'); px(19, hy - 7, '#ffd43b'); }
    if (ex.has('watch') && front) px(17, 27 + u + ra, '#fcc419');
    if (ex.has('egg')) { r(18, hy - 4, 4, 5, '#fcc419'); px(18, hy - 4, null); px(21, hy - 4, null); px(19, hy - 3, '#fff3bf'); r(19, hy, 3, 1, '#e8a317'); }
    if (ex.has('cane')) { r(20, hy - 1, 1, 13 - (u ? 0 : 0) + (39 - hy - 12), '#6b4423'); r(18, hy - 2, 3, 1, '#6b4423'); px(18, hy - 1, '#6b4423'); }

    // outline pass
    const c = document.createElement('canvas'); c.width = SW; c.height = SH;
    const cx = c.getContext('2d');
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      let col = g[y * SW + x];
      if (!col) {
        const n = (X, Y) => X >= 0 && X < SW && Y >= 0 && Y < SH && g[Y * SW + X];
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) col = OUT;
      }
      if (col) { cx.fillStyle = col; cx.fillRect(x, y, 1, 1); }
    }
    return c;
  }

  const cache = new Map();
  HH.avatarSprite = function (id, look, view, frame) {
    const k = id + view + frame;
    if (!cache.has(k)) cache.set(k, makeAvatar(look, view, frame));
    return cache.get(k);
  };

  // ---------- rotation ----------
  // A turned piece (rot: 1) has its footprint swapped (w ↔ d). In this projection swapping x and y is a
  // horizontal flip of the screen around view.ox, so every drawer turns for free: draw it in its own
  // orientation with x/y swapped, mirrored. Two orientations (along x, along y), like most Habbo furni.
  function withRot(ctx, f, draw) {
    if (!f.rot) return draw(f);
    ctx.save(); ctx.translate(2 * view.ox, 0); ctx.scale(-1, 1);
    draw({ ...f, x: f.y, y: f.x, w: f.d, d: f.w });
    ctx.restore();
  }
  const rawFurni = HH.drawFurni, rawRug = HH.drawRug;
  HH.drawFurni = (ctx, f, t) => withRot(ctx, f, (g) => rawFurni(ctx, g, t));
  HH.drawRug = (ctx, f, t) => withRot(ctx, f, (g) => rawRug(ctx, g, t));

  HH.drawShadow = function (ctx, x, y) {
    ctx.fillStyle = 'rgba(30,24,20,0.28)';
    [[-3, 1, 6], [-6, 2, 12], [-7, 3, 14], [-6, 4, 12], [-3, 5, 6]].forEach(([dx, dy, w]) => ctx.fillRect(x + dx, y + dy - 3, w, 1));
  };
})();
