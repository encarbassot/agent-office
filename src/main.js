/* Agent Office — loop, rooms, doors, presence, A*, input, overlay. */
(function () {
  const HH = window.HH;
  const { ROOMS, MAESTROS, PLAYER } = HH;

  // ---------- storage ----------
  const read = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

  // ---------- who is where ----------
  // Automatic: a character whose Claude Code agent is working goes to a desk in its room (HH.DEPT, or the work
  // room); a free one is in the lobby. The player can override it (call someone to a room, send them away): where[id].
  // Nameless agents (dummies) only exist while they work, at the free desks of the work room.
  // presence[id] = the room id they are in right now ('main', 'office', 'desk'…) or 'away'.
  const DEPT = HH.DEPT || {};
  // the room where agents without a department of their own work, and the player's own office (rooms.js)
  const WORK = HH.WORK_ROOM || Object.keys(ROOMS).find((id) => ROOMS[id].hot) || 'main';
  const HOME = (Object.values(ROOMS).find((r) => r.mine) || {}).id || 'main';
  const where = read('hh.where.v1', {});
  const saveWhere = () => write('hh.where.v1', where);
  let agentsNow = [];            // /api/agents (scripts/serve.mjs reads ~/.claude)
  const dummies = {};            // id → cfg of the crash-test dummies
  const agentOf = (id) => (dummies[id] ? dummies[id].agentInfo : agentsNow.find((a) => a.maestro === id)) || null;
  const workingNow = (id) => { const a = agentOf(id); return !!(a && a.working); };
  const locOf = (id) => (dummies[id] ? (workingNow(id) ? WORK : 'away') : where[id] || (workingNow(id) ? DEPT[id] || WORK : 'main'));
  const presence = Object.fromEntries(MAESTROS.map((m) => [m.id, locOf(m.id)]));
  const cfgOf = (id) => HH.byId(id) || dummies[id];
  const locLabel = (loc) => ({ main: 'En el lobby', away: 'Fuera', [HOME]: 'En tu despacho' })[loc] || (ROOMS[loc] ? 'En ' + ROOMS[loc].name : '—');
  const isHere = (r, id, loc) => loc === r.id;

  // What the player moves stays moved: furniture, wall items and where each maestro stands, per room.
  const DEFAULTS = Object.fromEntries(Object.values(ROOMS).map((r) => [r.id, JSON.stringify({ furniture: r.furniture, decos: r.decos || [], spots: r.spots || {} })]));
  const layouts = read('hh.layout.v2', {}); // v2: the layout format with `since`
  const LAYOUT_V = 2; // a default piece with `since: n` (n > the saved v) is added to rooms saved before it existed
  for (const [id, l] of Object.entries(layouts)) {
    const r = ROOMS[id]; if (!r) continue;
    if (l.furniture) {
      const fresh = r.furniture.filter((f) => f.since && f.since > (l.v || 1));
      r.furniture = l.furniture;
      for (const f of fresh) { // only if its tiles are still free in the saved room
        const clash = r.furniture.some((o) => !o.floor && !o.noBlock && f.x < o.x + o.w && f.x + f.w > o.x && f.y < o.y + o.d && f.y + f.d > o.y);
        if (!clash) r.furniture.push(f);
      }
    }
    if (l.decos) r.decos = l.decos;
    if (l.spots) r.spots = { ...(r.spots || {}), ...l.spots };
  }
  const bare = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))); // runtime fields (_dev…) never get saved
  const saveLayout = (r) => { layouts[r.id] = { v: LAYOUT_V, furniture: r.furniture.map(bare), decos: r.decos || [], spots: r.spots || {} }; write('hh.layout.v2', layouts); };
  function resetLayout(r) {
    Object.assign(r, JSON.parse(DEFAULTS[r.id]));
    delete layouts[r.id]; write('hh.layout.v2', layouts);
    computeBlocked();
  }

  // ---------- logical canvas ----------
  const LW = 336, LH = 272;
  const canvas = document.getElementById('room');
  const ctx = canvas.getContext('2d');
  const buf = document.createElement('canvas');
  buf.width = LW; buf.height = LH;
  const b = buf.getContext('2d');
  let S = 2, dpr = 1, cssScale = 1;

  // ---------- zoom & pan: the stage is a window onto the canvas (pinch, wheel, drag the empty floor) ----------
  // baseCss = css px per logical px that fits the screen; zoom multiplies it. The canvas keeps an integer
  // number of device px per logical px (S, capped so it never gets huge) and the browser does the rest.
  const stage = canvas.parentElement, ZMIN = 1, ZMAX = 3; // max zoom in: ×3 the size that fits
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  let zoom = clampN(Number(read('hh.zoom.v1', 1)) || 1, ZMIN, ZMAX), panX = 0, panY = 0, baseCss = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const wrap = stage.getBoundingClientRect();
    const rest = ['header', '#minis', '#roster', '#chat', 'footer'].reduce((s, q) => { const el = document.querySelector(q); return s + (el ? el.getBoundingClientRect().height : 0); }, 0);
    const availW = Math.max(200, wrap.width), availH = Math.max(140, window.innerHeight - rest - 40);
    const fitW = Math.floor((availW * dpr) / LW), fitH = Math.floor((availH * dpr) / LH);
    let s0 = Math.max(Math.round(dpr), Math.min(fitW, fitH));
    if (s0 > fitW) s0 = Math.max(1, fitW);
    let css = s0 / dpr;
    const best = Math.min(availW / LW, availH / LH);
    if (css < best * 0.8) css = best;
    baseCss = css;
    stage.style.height = Math.round(Math.max(LH * css, availH)) + 'px'; // a phone is taller than the room: use it all, there is room to pan
    layoutZoom();
  }
  function layoutZoom() {
    const css = baseCss * zoom, s = clampN(Math.round(css * dpr), 1, Math.floor(4096 / LW));
    if (s !== S || canvas.width !== LW * s) { S = s; canvas.width = LW * S; canvas.height = LH * S; }
    cssScale = css;
    canvas.style.width = LW * css + 'px'; canvas.style.height = LH * css + 'px';
    const sw = stage.clientWidth, sh = stage.clientHeight, cw = LW * css, ch = LH * css;
    const mx = Math.max(0, (cw - sw) / 2), my = Math.max(0, (ch - sh) / 2);
    panX = clampN(panX, -mx, mx); panY = clampN(panY, -my, my);
    canvas.style.left = Math.round((sw - cw) / 2 + panX) + 'px';
    canvas.style.top = Math.round((sh - ch) / 2 + panY) + 'px';
    zoomBox.classList.toggle('is-zoomed', zoom > 1.01);
  }
  // zoom to z keeping the point (cx, cy) of the stage where it is (under the fingers / the cursor)
  function zoomAt(z, cx, cy) {
    z = clampN(z, ZMIN, ZMAX);
    const sw = stage.clientWidth, sh = stage.clientHeight, cw0 = LW * cssScale, ch0 = LH * cssScale;
    const u = (cx - ((sw - cw0) / 2 + panX)) / cw0, v = (cy - ((sh - ch0) / 2 + panY)) / ch0;
    zoom = z;
    const cw1 = LW * baseCss * z, ch1 = LH * baseCss * z;
    panX = cx - u * cw1 - (sw - cw1) / 2; panY = cy - v * ch1 - (sh - ch1) / 2;
    layoutZoom(); write('hh.zoom.v1', zoom);
  }
  const stageXY = (x, y) => { const r = stage.getBoundingClientRect(); return [x - r.left, y - r.top]; };
  const zoomBox = document.getElementById('zoom');
  zoomBox.addEventListener('click', (e) => {
    const k = e.target.closest('button') && e.target.closest('button').dataset.z; if (!k) return;
    const c = [stage.clientWidth / 2, stage.clientHeight / 2];
    if (k === 'fit') { panX = panY = 0; zoomAt(1, ...c); } else zoomAt(zoom * (k === 'in' ? 1.5 : 1 / 1.5), ...c);
  });
  canvas.addEventListener('wheel', (e) => { // mouse wheel and trackpad pinch (ctrlKey) zoom around the cursor
    e.preventDefault();
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018));
    zoomAt(zoom * k, ...stageXY(e.clientX, e.clientY));
  }, { passive: false });
  window.addEventListener('resize', resize);
  let stageW = 0; // the pane may still be laying out on the first resize: redo it when the stage gets its real width
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (Math.abs(stage.clientWidth - stageW) > 1) { stageW = stage.clientWidth; resize(); } }).observe(stage);

  // ---------- current room + grid ----------
  let room = null, W = 0, H = 0, blocked = [];
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const free = (x, y) => inside(x, y) && !blocked[y][x];
  function setupRoom(r) {
    room = r; W = r.W; H = r.H;
    HH.view.ox = Math.round(LW / 2 - 8 * (W - H));
    const freeV = LH - 31 - r.WH - 8 * (W + H) - 7;
    HH.view.oy = Math.round(22 + r.WH + freeV / 2);
    computeBlocked();
    for (const d of r.doors) d.color = (ROOMS[d.to] && ROOMS[d.to].accent) || '#6b5a48';
  }
  const blocks = (f) => !f.floor && !f.noBlock;
  function computeBlocked() {
    blocked = Array.from({ length: H }, () => new Array(W).fill(false));
    for (const f of room.furniture) if (blocks(f)) for (let j = 0; j < f.d; j++) for (let i = 0; i < f.w; i++) if (inside(f.x + i, f.y + j)) blocked[f.y + j][f.x + i] = true;
  }

  // A* with 8 directions, no corner cutting
  function findPath(sx, sy, tx, ty, avoid) {
    if (!free(tx, ty)) return null;
    const key = (x, y) => y * W + x;
    const open = [{ x: sx, y: sy, g: 0, f: 0 }], from = new Map(), gs = new Map([[key(sx, sy), 0]]), closed = new Set();
    const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0], ck = key(cur.x, cur.y);
      if (cur.x === tx && cur.y === ty) {
        const path = []; let k = ck;
        while (k !== key(sx, sy)) { path.unshift([k % W, Math.floor(k / W)]); k = from.get(k); }
        return path;
      }
      if (closed.has(ck)) continue; closed.add(ck);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!free(nx, ny) || (avoid && avoid.has(key(nx, ny)) && !(nx === tx && ny === ty))) continue;
        if (dx && dy && (!free(cur.x + dx, cur.y) || !free(cur.x, cur.y + dy))) continue;
        const g = cur.g + (dx && dy ? 1.41 : 1), nk = key(nx, ny);
        if (g < (gs.get(nk) ?? Infinity)) { gs.set(nk, g); from.set(nk, ck); open.push({ x: nx, y: ny, g, f: g + h(nx, ny) }); }
      }
    }
    return null;
  }

  // ---------- actors ----------
  const rnd = (a, c) => a + Math.random() * (c - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function makeActor(cfg, x, y, isPlayer) {
    const now = performance.now();
    return { cfg, isPlayer, tx: x, ty: y, fx: x, fy: y, path: [], prog: 0, wait: 0, view: 'front', mirror: false, frame: 0, alpha: 1, seed: Math.random() * 1e4,
      idleUntil: now + rnd(4000, 12000), nextTalk: now + rnd(6000, 25000), nextAct: now + rnd(2500, 9000), bubble: null, act: null };
  }
  let actors = [], player = null;
  const occupiedBy = (x, y, me) => actors.find((a) => a !== me && !a.isPlayer && !a.held && ((a.tx === x && a.ty === y) || (a.path[0] && a.prog > 0 && a.path[0][0] === x && a.path[0][1] === y)));
  function randomFreeNear([hx, hy], rad) {
    for (let n = 0; n < 40; n++) {
      const x = Math.round(hx + rnd(-rad, rad)), y = Math.round(hy + rnd(-rad, rad));
      if (free(x, y) && !actors.some((a) => !a.held && a.tx === x && a.ty === y)) return [x, y];
    }
    return null;
  }
  function others(me) { const s = new Set(); for (const a of actors) if (a !== me && !a.held) s.add(a.ty * W + a.tx); return s; }
  function goTo(a, x, y) {
    // the player is omnipotent: walks through people
    const p = a.isPlayer ? findPath(a.tx, a.ty, x, y) : findPath(a.tx, a.ty, x, y, others(a)) || findPath(a.tx, a.ty, x, y);
    if (p) { a.path = p; a.prog = 0; if (a.sitting) { a.sitting = null; a.typing = false; } } // walking = standing up
    return !!p;
  }

  // ---------- sitting: chairs, armchairs, sofas. Every seat faces the room (+y, or +x when turned) ----------
  const SEAT_Z = { chair: 9, armchair: 8, sofa: 9, dirchair: 11 };
  const isSeat = (f) => SEAT_Z[f.type] != null;
  const seatTaken = (x, y, me) => actors.some((o) => o !== me && o.sitting && o.tx === x && o.ty === y);
  // walk to the free tile next to the nearest free seat of f, then hop onto it
  function sitDown(a, f) {
    const seats = [];
    for (let j = 0; j < f.d; j++) for (let i = 0; i < f.w; i++) if (!seatTaken(f.x + i, f.y + j, a)) seats.push([f.x + i, f.y + j]);
    if (!seats.length) { flashHint('Ese sitio está ocupado'); return; }
    seats.sort((p, q) => Math.hypot(p[0] - a.tx, p[1] - a.ty) - Math.hypot(q[0] - a.tx, q[1] - a.ty));
    for (const seat of seats) {
      if (Math.abs(a.tx - seat[0]) <= 1 && Math.abs(a.ty - seat[1]) <= 1 && !a.path.length) { hop(a, f, seat); return; }
      const near = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => [seat[0] + dx, seat[1] + dy]).filter(([x, y]) => free(x, y))
        .sort((p, q) => Math.hypot(p[0] - a.tx, p[1] - a.ty) - Math.hypot(q[0] - a.tx, q[1] - a.ty));
      for (const t of near) if (goTo(a, t[0], t[1])) { a.onArrive = () => hop(a, f, seat); marker = { x: t[0], y: t[1], until: performance.now() + 700 }; return; }
    }
    flashHint('No llego a ese asiento');
  }
  function hop(a, f, [x, y]) {
    if (!room.furniture.includes(f) || seatTaken(x, y, a)) return;
    a.path = []; a.prog = 0; a.tx = a.fx = x; a.ty = a.fy = y;
    a.sitting = { f, z: SEAT_Z[f.type] };
    a.typing = !a.isPlayer && workingNow(a.cfg.id) && !!deskOf(a.cfg.id); // at their desk while their agent works
    const s = f.flip ? -1 : 1; // facing: +y, +x (turned), −y / −x when flipped (back to us)
    if (f.rot) setDir(a, s, 0); else setDir(a, 0, s);
  }
  // furniture moved or put away under someone: they stand up where they are
  function standUpOrphans() {
    for (const a of actors) if (a.sitting) {
      const f = a.sitting.f;
      if (!room.furniture.includes(f) || a.tx < f.x || a.tx >= f.x + f.w || a.ty < f.y || a.ty >= f.y + f.d) {
        a.sitting = null; const [x, y] = nearestFree(a.tx, a.ty); a.tx = a.fx = x; a.ty = a.fy = y;
      }
    }
  }
  function setDir(a, dx, dy) {
    const sx = dx - dy, sy = dx + dy;
    a.view = sy >= 0 ? 'front' : 'back';
    a.mirror = a.view === 'front' ? sx < 0 : sx > 0;
  }
  function face(a, o) { setDir(a, Math.sign(o.tx - a.tx), Math.sign(o.ty - a.ty)); }
  // where someone works in this room: their desk chair (departments) or a free one (dummies)
  function deskOf(id) {
    if (room.desks && room.desks[id]) return room.desks[id];
    if (!room.hot) return null; // no desk of their own: a free one (dummies, or anyone whose department is this room)
    const mine = actorOf(id) && actorOf(id).hotDesk;
    if (mine) return mine;
    return room.hot.find(([x, y]) => !actors.some((o) => o.hotDesk && o.hotDesk[0] === x && o.hotDesk[1] === y)) || null;
  }
  const chairAt = (x, y) => room.furniture.find((f) => isSeat(f) && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.d);
  // somewhere to be in room r for someone with no spot of their own: the room's `idle` spots, in roster order
  const idleOf = (r, id) => { const i = MAESTROS.findIndex((m) => m.id === id); return r.idle && i >= 0 ? r.idle[i % r.idle.length] : null; };
  const spotOf = (id) => (room.spots && room.spots[id]) || (deskOf(id) ? [...deskOf(id), 0, -1] : null) || idleOf(room, id);
  // the door towards a room (or the way out)
  const doorTo = (dest) => room.doors.find((d) => d.to === dest) || room.doors.find((d) => d.to === 'main') || room.doors[0];
  const actorOf = (id) => actors.find((a) => a.cfg.id === id);

  // working + a desk here → sit at it and type
  function goToWork(a, instant) {
    const t = deskOf(a.cfg.id), f = t && chairAt(t[0], t[1]);
    if (!f || !workingNow(a.cfg.id)) return false;
    if (!(room.desks && room.desks[a.cfg.id])) a.hotDesk = t;
    if (instant) hop(a, f, t); else sitDown(a, f);
    return true;
  }
  function placeMaestro(m, entering, from) {
    const sp = spotOf(m.id) || [Math.floor(W / 2), Math.floor(H / 2), 0, 1];
    let [x, y] = sp;
    if (!free(x, y) || actors.some((a) => a.tx === x && a.ty === y)) [x, y] = randomFreeNear(sp, 2) || [1, 1];
    if (!entering) { const a = makeActor(m, x, y, false); setDir(a, sp[2], sp[3]); actors.push(a); goToWork(a, true); return a; }
    const d = doorTo(from), [dx, dy] = HH.doorTile(d);
    const a = makeActor(m, dx, dy, false); a.alpha = 0; a.fadeIn = performance.now();
    actors.push(a); openDoor(d);
    if (goToWork(a, false)) return a;
    goTo(a, x, y);
    a.onArrive = () => { setDir(a, sp[2], sp[3]); if (AMBIENT_TALK && !a.bubble && visibleBubbles() < 2) say(a, pick(m.phrases)); };
    return a;
  }
  function leave(a, dest) {
    const d = doorTo(dest), [dx, dy] = HH.doorTile(d);
    a.leaving = true; a.bubble = null;
    if (a.tx === dx && a.ty === dy) { vanish(a, d); return; }
    if (!goTo(a, dx, dy)) { vanish(a, d); return; }
    a.onArrive = () => vanish(a, d);
  }
  function vanish(a, d) { openDoor(d); a.fadeOut = performance.now(); }
  function openDoor(d) { if (d) d.openUntil = performance.now() + 900; }

  function enterRoom(id, fromId) {
    if (placing) cancelPlacing();
    editing = false; sel = null; chip = null; // edit mode is per room: entering another one leaves it
    const r = ROOMS[id];
    setupRoom(r);
    actors = [];
    const entry = r.doors.find((d) => d.to === fromId) || (fromId ? r.doors[0] : null);
    const [px, py] = entry ? HH.doorTile(entry) : r.spawn || [1, 1];
    player = makeActor(PLAYER, px, py, true);
    actors.push(player);
    for (const m of [...MAESTROS, ...Object.values(dummies)]) {
      if (isHere(r, m.id, presence[m.id])) placeMaestro(m, false);
    }
    if (entry) { openDoor(entry); const inward = entry.wall === 'R' ? [px, py + 1] : [px + 1, py]; if (free(...inward)) goTo(player, ...inward); }
    marker = null; hover = null; selected = null;
    write('hh.room.v1', id);
    renderHeader(); renderRoster(); buildMinis(); hideTip();
    attachDevices();
  }

  // move someone to another room; walks out / in if it's the room you're looking at
  function setPresence(id, loc) {
    const before = presence[id];
    if (before === loc) return;
    presence[id] = loc;
    const here = (l) => isHere(room, id, l);
    const a = actorOf(id);
    if (here(before) && !here(loc) && a) leave(a, loc);
    if (!here(before) && here(loc)) {
      if (a && a.leaving) { a.leaving = false; a.fadeOut = 0; a.alpha = 1; a.onArrive = null; if (!goToWork(a, false)) { const sp = spotOf(id); if (sp) goTo(a, sp[0], sp[1]); } }
      else if (!a) placeMaestro(cfgOf(id), true, before);
    }
    renderRoster(); renderWho();
  }
  // the player decides (or lets the work decide: loc = null)
  function setWhere(id, loc) {
    if (loc) where[id] = loc; else delete where[id];
    saveWhere(); syncPresence();
  }
  // everyone to where they should be now (after a poll of the agents or a decision of the player)
  function syncPresence() {
    for (const id of [...MAESTROS.map((m) => m.id), ...Object.keys(dummies)]) {
      const loc = locOf(id);
      if (presence[id] !== loc) setPresence(id, loc);
      const a = actorOf(id); // still in the same room but the work started / stopped
      if (a && !a.leaving) {
        if (workingNow(id) && !a.sitting && !a.path.length && deskOf(id)) goToWork(a, false);
        if (a.sitting) a.typing = workingNow(id) && !!deskOf(id);
      }
    }
    renderMinisSoon();
  }

  // ---------- bubbles ----------
  function say(a, text, opts = {}) {
    a.bubble = { text, born: performance.now(), until: performance.now() + 2600 + text.length * 70 };
    const tts = HH.TTS;
    if (tts && !a.isPlayer && (opts.speak || tts.opts.bubbles)) tts.speak(a.cfg, text);
  }
  const visibleBubbles = () => actors.filter((a) => a.bubble).length;
  // they only talk when you talk to them (chat, call, tap). true = they chat on their own.
  const AMBIENT_TALK = false;

  // ---------- behaviour: mostly stay at their spot doing their thing ----------
  function decide(a, now) {
    const sp = spotOf(a.cfg.id), mul = a.cfg.idleMul || 1;
    const atSpot = sp && a.tx === sp[0] && a.ty === sp[1];
    if (sp && !atSpot) { // wandered off: go back to work
      if (!goTo(a, sp[0], sp[1])) a.idleUntil = now + 3000;
      else a.onArrive = () => setDir(a, sp[2], sp[3]);
      return;
    }
    a.idleUntil = now + rnd(12000, 30000) * mul;
    const r = Math.random();
    if (r < 0.7) { // turn a bit, then back to the work
      setDir(a, pick([-1, 0, 1]), pick([-1, 0, 1]) || 1);
      setTimeout(() => { if (sp && !a.path.length) setDir(a, sp[2], sp[3]); }, 2500);
      return;
    }
    if (r < 0.92) { // stretch the legs: one step and back
      const t = randomFreeNear(sp || [a.tx, a.ty], 1);
      if (t && goTo(a, t[0], t[1])) a.onArrive = () => { a.idleUntil = performance.now() + rnd(2500, 5000) * mul; };
      return;
    }
    if (room.id !== 'main') return;
    const friend = pick(actors.filter((o) => o !== a && !o.isPlayer && !o.leaving)); // a quick chat at the table
    const t = friend && randomFreeNear([friend.tx, friend.ty], 1);
    if (t && goTo(a, t[0], t[1])) a.onArrive = () => { face(a, friend); if (AMBIENT_TALK && !a.bubble && visibleBubbles() < 2) say(a, pick(a.cfg.phrases)); a.idleUntil = performance.now() + rnd(3000, 6000); };
  }

  function update(dt, now) {
    if (drag && drag.kind === 'actor') swing(drag, dt);
    for (const a of actors) {
      if (a.bubble && now > a.bubble.until) a.bubble = null;
      if (a.held) continue;
      if (a.dropZ > 0) { // dropped from the hand: falls, one small bounce
        a.vz += 1600 * (dt / 1000); a.dropZ -= a.vz * (dt / 1000);
        if (a.dropZ <= 0) { if (a.vz > 260) { a.vz = -a.vz * 0.32; a.dropZ = 0.01; } else { a.dropZ = 0; a.vz = 0; } }
        continue;
      }
      if (a.fadeIn) { a.alpha = Math.min(1, (now - a.fadeIn) / 500); if (a.alpha >= 1) a.fadeIn = 0; }
      if (a.fadeOut) { a.alpha = Math.max(0, 1 - (now - a.fadeOut) / 400); }
      if (a.path.length) {
        const [nx, ny] = a.path[0];
        if (a.prog === 0) {
          const o = a.isPlayer ? null : occupiedBy(nx, ny, a);
          if (o && !(o.tx === a.tx && o.ty === a.ty)) {
            if (a.path.length === 1 && !o.path.length) { a.path = []; a.idleUntil = now + 1500; face(a, o); if (a.onArrive) { const f = a.onArrive; a.onArrive = null; f(); } continue; }
            a.wait += dt; a.frame = 0;
            if (a.wait > 1200) {
              a.wait = 0;
              const end = a.path[a.path.length - 1];
              const p = findPath(a.tx, a.ty, end[0], end[1], others(a));
              if (p && p.length) a.path = p; else { a.path = []; a.idleUntil = now + 800; }
            }
            continue;
          }
          a.wait = 0;
          setDir(a, nx - a.tx, ny - a.ty);
        }
        const diag = nx !== a.tx && ny !== a.ty ? 1.3 : 1;
        a.prog += dt / (a.cfg.stepMs * diag);
        if (a.prog >= 1) {
          a.tx = nx; a.ty = ny; a.prog = 0; a.path.shift();
          a.fx = a.tx; a.fy = a.ty;
          if (!a.path.length) { a.frame = 0; a.idleUntil = Math.max(a.idleUntil, now + rnd(6000, 14000) * (a.cfg.idleMul || 1)); if (a.onArrive) { const f = a.onArrive; a.onArrive = null; f(); } }
        } else {
          a.fx = a.tx + (nx - a.tx) * a.prog; a.fy = a.ty + (ny - a.ty) * a.prog;
          a.frame = Math.floor(a.prog * 4) % 4;
        }
      } else if (!a.isPlayer && !a.leaving && !a.sitting && now > a.idleUntil) decide(a, now);
      if (!a.isPlayer && !a.leaving) {
        if (now > a.nextAct && !a.path.length && a.cfg.activities && a.cfg.activities.length) { // doing their thing
          a.nextAct = now + rnd(7000, 16000);
          a.act = { text: pick(a.cfg.activities), born: now };
        }
        if (AMBIENT_TALK && now > a.nextTalk) {
          a.nextTalk = now + rnd(20000, 45000);
          if (!a.bubble && visibleBubbles() < 2) say(a, pick(a.cfg.phrases));
        }
      }
    }
    actors = actors.filter((a) => !(a.fadeOut && a.alpha <= 0));
  }

  // ---------- render ----------
  let hover = null, marker = null, selected = null, sparkle = null;
  function render(now) {
    b.clearRect(0, 0, LW, LH);
    HH.drawRoom(b, room, now);
    lightDesks(room, actors.filter((a) => a.typing).map((a) => [a.tx, a.ty]));
    for (const f of room.furniture) if (f.floor) { b.globalAlpha = drag && drag.f === f ? 0.72 : 1; HH.drawRug(b, f, now); b.globalAlpha = 1; }
    if (placing && placing.ghost && placing.ghost.floor) { b.globalAlpha = 0.7; HH.drawRug(b, placing.ghost, now); b.globalAlpha = 1; }
    if (hover && free(hover[0], hover[1])) HH.drawTileHighlight(b, hover[0], hover[1], HH.PAL.hover);
    if (marker && now < marker.until) HH.drawTileHighlight(b, marker.x, marker.y, Math.floor(now / 120) % 2 ? '#ffffff' : '#51cf66');
    if (editing) { // edit mode: the floor shows its grid, the selected thing is outlined in yellow
      const fa = parseInt(((room.pal && room.pal.floorA) || HH.PAL.floorA).slice(1), 16), lum = ((fa >> 16) & 255) * 0.3 + ((fa >> 8) & 255) * 0.59 + (fa & 255) * 0.11;
      const gridC = lum > 140 ? 'rgba(20,16,28,0.3)' : 'rgba(255,255,255,0.25)'; // dark lines on light floors, light on dark
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) HH.drawTileHighlight(b, x, y, gridC);
      if (sel && sel.kind) {
        const bb = HH.decoBounds(sel), q = [HH.wp(sel.wall, bb.a0, bb.z0), HH.wp(sel.wall, bb.a1, bb.z0), HH.wp(sel.wall, bb.a1, bb.z1), HH.wp(sel.wall, bb.a0, bb.z1)];
        for (let i = 0; i < 4; i++) HH.line(b, ...q[i], ...q[(i + 1) % 4], '#ffd43b');
      }
    }
    const moving = (drag && drag.kind === 'furni' && drag.f) || (placing && placing.ghost && placing.ghost.type && placing.ghost);
    if (moving) footprint(moving, drag ? drag.ok : placing.ok);
    if (drag && drag.kind === 'actor') {
      const [tx, ty] = drag.tile, c = HH.P(tx + 0.5, ty + 0.5).map(Math.round);
      HH.drawTileHighlight(b, tx, ty, drag.okTile ? '#51cf66' : '#ff8787');
      HH.drawShadow(b, c[0], c[1]);
    }

    const items = [];
    for (const f of room.furniture) if (!f.floor) items.push({ k: f.x + f.y + f.w + f.d - 1 - (f.noBlock ? 0.5 : 0), f });
    for (const a of actors) if (!a.held) items.push({ k: a.sitting && a.sitting.f.flip ? fk(a.sitting.f) - 0.05 : a.fx + a.fy + 1.01, a }); // facing the wall: behind the backrest
    if (placing && placing.ghost && placing.ghost.type && !placing.ghost.floor) items.push({ k: placing.ghost.x + placing.ghost.y + placing.ghost.w + placing.ghost.d - 1, f: placing.ghost, ghost: true });
    items.sort((p, q) => p.k - q.k);
    for (const it of items) {
      if (it.f) { b.globalAlpha = it.ghost || (drag && drag.f === it.f) ? 0.72 : 1; HH.drawFurni(b, it.f, now); b.globalAlpha = 1; continue; }
      const a = it.a, [sx, sy] = HH.P(a.fx + 0.5, a.fy + 0.5).map(Math.round);
      b.globalAlpha = a.alpha;
      if (!a.sitting) HH.drawShadow(b, sx, sy);
      const spr = HH.avatarSprite(a.cfg.spriteId || a.cfg.id, a.cfg.look, a.view, frameOf(a, now));
      const dx = sx - 13, dy = a.sitting ? sy - a.sitting.z - 31 : sy - HH.SPRITE.footY - Math.round(a.dropZ || 0); // sitting: hips on the seat
      if (a.mirror) { b.save(); b.translate(dx + HH.SPRITE.W, dy); b.scale(-1, 1); b.drawImage(spr, 0, 0); b.restore(); }
      else b.drawImage(spr, dx, dy);
      b.globalAlpha = 1;
      a.screen = a.sitting ? [sx, sy - a.sitting.z + 9] : [sx, sy - Math.round(a.dropZ || 0)];
    }
    if (editing && sel && sel.type && !(drag && drag.f === sel)) { // selected: its footprint in yellow, on top so it shows round tall things
      const blink = Math.floor(now / 500) % 2 ? '#ffd43b' : '#fff3bf';
      for (let j = 0; j < sel.d; j++) for (let i = 0; i < sel.w; i++) HH.drawTileHighlight(b, sel.x + i, sel.y + j, blink);
    }
    if (placing && placing.ghost && placing.ghost.kind) { b.globalAlpha = placing.ok ? 0.8 : 0.4; (HH.DECO[placing.ghost.kind] || HH.DECO.poster)(b, placing.ghost, now, room); b.globalAlpha = 1; }
    if (drag && drag.kind === 'actor') { // hanging by the head, like a Mii picked up with the Wii remote
      const a = drag.a, spr = HH.avatarSprite(a.cfg.id, a.cfg.look, 'front', Math.floor(now / 110) % 4);
      b.imageSmoothingEnabled = false;
      b.save(); b.translate(Math.round(drag.px), Math.round(drag.py)); b.rotate(-drag.th); b.drawImage(spr, -13, -HEAD_Y); b.restore();
      a.screen = [Math.round(drag.px), Math.round(drag.py) + 36 - 6];
    }
    if (sparkle && now < sparkle.until) { // the player teleports
      const k = 1 - (sparkle.until - now) / 600, c = HH.P(sparkle.x + 0.5, sparkle.y + 0.5);
      for (let i = 0; i < 8; i++) { const an = (i / 8) * Math.PI * 2; HH.dot(b, [c[0] + Math.cos(an) * k * 14, c[1] - 14 + Math.sin(an) * k * 10], i % 2 ? '#fff3bf' : '#ffd43b', 2, 2); }
    }

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buf, 0, 0, LW * S, LH * S);
    drawOverlay(now);
    placeTool(now);
    placeTip(now);
    if (now - minisAt > 500) { minisAt = now; updateMinis(now); }
  }

  // a name tag over every rack that holds a device: 🟢 server · 50 ms / 🔴 nas (staggered so they don't pile up)
  function rackTags(kk, now) {
    const racks = racksOf(room).filter((f) => f._dev);
    if (!racks.length) return;
    const fs = Math.round(Math.min(11, Math.max(9, cssScale * 2.6)) * kk), pad = Math.round(2.5 * kk);
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 ${fs}px ${FONT}`;
    racks.forEach((f, i) => {
      const d = f._dev, p = HH.P(f.x + 0.5, f.y + 0.5, 62 + (i % 2) * 13);
      const label = `${d.up ? '🟢' : '🔴'} ${d.name}${d.up && d.ms != null && zoom > 1.6 ? ' · ' + d.ms + ' ms' : ''}`;
      const tw = ctx.measureText(label).width + pad * 2, th = fs + pad * 1.2, x = p[0] * S, y = p[1] * S;
      ctx.fillStyle = d.up ? 'rgba(10,30,15,0.78)' : 'rgba(60,10,10,0.85)';
      roundRect(x - tw / 2, y - th / 2, tw, th, 3 * kk); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, x, y + kk * 0.5);
    });
    ctx.restore();
  }

  // which sprite frame: walking steps, sitting, or typing (the two hands take turns, not quite in rhythm)
  function frameOf(a, now) {
    if (a.typing) { const k = Math.floor((now + (a.seed || 0)) / 140); return (k * 7 + (k >> 2)) % 3 ? 'k' + (k % 2) : 'k0'; }
    return a.sitting ? 's' : a.path.length ? a.frame : 0;
  }
  // a desk's screen is on while someone types at the chair in front of it
  function lightDesks(r, seats) {
    for (const f of r.furniture) if (f.type === 'workdesk') {
      const cx = f.x + (f.rot ? 1 : 0), cy = f.y + (f.rot ? 0 : 1);
      f._on = seats.some(([x, y]) => x === cx && y === cy);
    }
  }

  // the neon tubes glow at screen resolution: one blurred fill per colour
  function neonGlow(d, now) {
    const off = HH.neonFlicker(d, now), by = {};
    for (const s of HH.neonSegs(d)) if (s.ch !== off) (by[s.color] = by[s.color] || []).push(s);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [col, list] of Object.entries(by)) {
      ctx.beginPath();
      for (const s of list) {
        const q = [HH.wp(d.wall, s.a0, s.z0), HH.wp(d.wall, s.a1, s.z0), HH.wp(d.wall, s.a1, s.z1), HH.wp(d.wall, s.a0, s.z1)];
        ctx.moveTo(q[0][0] * S, q[0][1] * S); for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0] * S, q[i][1] * S); ctx.closePath();
      }
      ctx.shadowColor = col; ctx.shadowBlur = 4 * S; ctx.fillStyle = col; ctx.globalAlpha = 0.32 + 0.06 * Math.sin(now / 340);
      ctx.fill();
    }
    ctx.restore();
  }

  // tags, door signs, activities and bubbles at screen resolution (crisp text)
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
  function wrap(text, maxW) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  const FONT = 'ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif';
  function drawOverlay(now) {
    const k = S / cssScale;
    const fs = Math.round(Math.min(13, Math.max(10, cssScale * 3.2)) * k);
    const pad = Math.round(3 * k);
    for (const d of room.decos || []) if (d.kind === 'neon') neonGlow(d, now);
    rackTags(k, now);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    // door signs: whose door it is (main) or the way back (caves)
    // the name plate over each door: where it goes, and how many are working in there (a room with racks: + the network)
    for (const d of room.doors) {
      const p = HH.wp(d.wall, d.at + 0.5, HH.DOOR_H + 10.5), to = ROOMS[d.to];
      const busy = Object.keys(presence).filter((id) => presence[id] === d.to && workingNow(id)).length;
      const net = to && to.furniture.some((f) => f.type === 'rack') && devices ? ` · 🖥 ${devices.filter((x) => x.up).length}/${devices.length}` : '';
      const lbl = to ? `${to.emoji} ${to.name}${busy ? ' · ⌨️ ' + busy : ''}${net}` : '🏨 Lobby';
      ctx.font = `700 ${Math.round(fs * 0.8)}px ${FONT}`;
      const tw = ctx.measureText(lbl).width + pad * 2, th = Math.round(fs * 0.8) + pad * 1.3, x = p[0] * S, y = p[1] * S;
      ctx.fillStyle = 'rgba(14,12,22,0.82)'; roundRect(x - tw / 2, y - th / 2, tw, th, 3 * k); ctx.fill();
      ctx.fillStyle = d.color || '#6b5a48'; ctx.fillRect(Math.round(x - tw / 2), Math.round(y + th / 2 - Math.max(1, k * 1.2)), Math.round(tw), Math.max(1, Math.round(k * 1.2)));
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(lbl, x, y + k * 0.5);
    }
    const order = [...actors].sort((p, q) => p.fy + p.fx - (q.fy + q.fx));
    const taken = [];
    for (const a of order) {
      if (!a.screen) continue;
      ctx.globalAlpha = a.alpha;
      const x = a.screen[0] * S, headY = (a.screen[1] - 36) * S;
      ctx.font = `700 ${fs}px ${FONT}`;
      const label = (a.cfg.emoji ? a.cfg.emoji + ' ' : '') + a.cfg.name;
      const tw = ctx.measureText(label).width + pad * 2, th = fs + pad * 1.4;
      let ty = headY - th - 2 * k;
      const tx0 = x - tw / 2;
      for (const r of taken) if (tx0 < r[0] + r[2] && tx0 + tw > r[0] && ty < r[1] + r[3] && ty + th > r[1]) ty = r[1] - th - 1 * k; // don't pile tags
      taken.push([tx0, ty, tw, th]);
      ctx.fillStyle = a === selected ? 'rgba(255,255,255,0.95)' : a.isPlayer ? 'rgba(20,90,50,0.85)' : 'rgba(10,10,20,0.72)';
      roundRect(x - tw / 2, ty, tw, th, 4 * k); ctx.fill();
      ctx.fillStyle = a === selected ? '#111' : '#fff'; ctx.textAlign = 'center';
      ctx.fillText(label, x, ty + th / 2 + dpr * 0.5);
      if (a.typing) { // «typing…» dots next to the name tag
        const ph = Math.floor(now / 260) % 3;
        for (let i = 0; i < 3; i++) { ctx.fillStyle = i === ph ? '#ffd43b' : 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(x + tw / 2 + (5 + i * 5) * k, ty + th / 2, 1.6 * k, 0, 7); ctx.fill(); }
      }
      if (a.isPlayer && !a.path.length) {
        const ay = ty - 6 * k + Math.sin(now / 250) * 2 * k;
        ctx.fillStyle = '#69db7c'; ctx.beginPath(); ctx.moveTo(x - 5 * k, ay - 5 * k); ctx.lineTo(x + 5 * k, ay - 5 * k); ctx.lineTo(x, ay); ctx.fill();
      }
      // activity: a small emoji that floats up from the head (e.g. 📐 repasa un plano)
      if (a.act && !a.bubble) {
        const age = (now - a.act.born) / 2600;
        if (age < 1) {
          const em = a.act.text.split(' ')[0];
          ctx.globalAlpha = a.alpha * Math.min(1, (1 - age) * 3, age * 8);
          ctx.font = `${fs}px ${FONT}`;
          ctx.fillText(em, x + tw / 2 + 2 * k, ty - age * 14 * k);
        } else a.act = null;
        ctx.globalAlpha = a.alpha;
      }
      a.bubbleRect = null;
      if (a.bubble) {
        ctx.font = `600 ${fs}px ${FONT}`;
        const maxW = Math.min(170 * k, canvas.width * 0.6);
        const lines = wrap(a.bubble.text, maxW);
        const lh = fs * 1.25;
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 3 + (a.isPlayer ? 0 : fs);
        const bh = lines.length * lh + pad * 2;
        const age = (now - a.bubble.born) / 1000;
        let by = ty - bh - 8 * k - Math.min(age, 1) * 4 * k;
        const bx = Math.min(Math.max(x - bw / 2, 4 * k), canvas.width - bw - 4 * k);
        for (const r of taken) if (bx < r[0] + r[2] && bx + bw > r[0] && by < r[1] + r[3] && by + bh > r[1]) by = r[1] - bh - 4 * k;
        by = Math.max(by, 2 * k);
        taken.push([bx, by, bw, bh]);
        a.bubbleRect = [bx, by, bw, bh];
        ctx.globalAlpha = a.alpha * Math.min(1, (a.bubble.until - now) / 400, age * 4);
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1a1420'; ctx.lineWidth = Math.max(1, k);
        roundRect(bx, by, bw, bh, 6 * k); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 4 * k, by + bh - 0.5); ctx.lineTo(x + 4 * k, by + bh - 0.5); ctx.lineTo(x, by + bh + 6 * k); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 4 * k, by + bh); ctx.lineTo(x, by + bh + 6 * k); ctx.lineTo(x + 4 * k, by + bh); ctx.stroke();
        ctx.fillStyle = a.cfg.accent || '#212529';
        ctx.fillRect(bx, by + 4 * k, 3 * k, bh - 8 * k);
        ctx.fillStyle = '#1a1420'; ctx.textAlign = 'left';
        lines.forEach((l, i) => ctx.fillText(l, bx + pad * 1.8, by + pad + lh * (i + 0.5)));
        if (!a.isPlayer) { ctx.font = `${Math.round(fs * 0.8)}px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText('🔊', bx + bw - pad, by + bh / 2); }
        ctx.textAlign = 'center';
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- input ----------
  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * LW, ((e.clientY - r.top) / r.height) * LH];
  }
  function actorAt(lx, ly) {
    const sorted = [...actors].sort((p, q) => q.fx + q.fy - (p.fx + p.fy));
    return sorted.find((a) => a.screen && !a.fadeOut && Math.abs(lx - a.screen[0]) <= 8 && ly <= a.screen[1] + 2 && ly >= a.screen[1] - 36);
  }
  function bubbleAt(lx, ly) {
    const x = lx * S, y = ly * S;
    return actors.find((a) => a.bubbleRect && !a.isPlayer && x >= a.bubbleRect[0] && x <= a.bubbleRect[0] + a.bubbleRect[2] && y >= a.bubbleRect[1] && y <= a.bubbleRect[1] + a.bubbleRect[3]);
  }
  function inPoly(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function doorAt(lx, ly, tile) {
    return room.doors.find((d) => { const [dx, dy] = HH.doorTile(d); return inPoly([lx, ly], HH.doorQuad(d)) || (tile && tile[0] === dx && tile[1] === dy); });
  }
  function tileAt(lx, ly) { const [wx, wy] = HH.unproject(lx, ly); return [Math.floor(wx), Math.floor(wy)]; }

  // ---------- picking: what is under the pointer (pixel-exact, not the tile behind it) ----------
  const pickC = document.createElement('canvas'); pickC.width = LW; pickC.height = LH;
  const pk = pickC.getContext('2d', { willReadFrequently: true });
  const fk = (f) => f.x + f.y + f.w + f.d - 1 - (f.noBlock ? 0.5 : 0);
  function furniAt(lx, ly, withRugs) {
    const x = Math.floor(lx), y = Math.floor(ly), now = performance.now();
    if (x < 0 || y < 0 || x >= LW || y >= LH) return null;
    const hit = (draw) => { pk.clearRect(0, 0, LW, LH); draw(); return pk.getImageData(x, y, 1, 1).data[3] > 40; };
    for (const f of room.furniture.filter((o) => !o.floor).sort((p, q) => fk(q) - fk(p))) if (hit(() => HH.drawFurni(pk, f, now))) return f;
    if (withRugs) for (const f of [...room.furniture].reverse()) if (f.floor && hit(() => HH.drawRug(pk, f, now))) return f;
    return null;
  }
  // a point on a wall: R wall a = x, L wall a = y; z = px up from the floor
  function wallCoords(wall, lx, ly) {
    const { ox, oy } = HH.view, a = wall === 'R' ? (lx - ox) / 16 : (ox - lx) / 16;
    return [a, oy + a * 8 - ly];
  }
  function decoAt(lx, ly) {
    for (const d of [...(room.decos || [])].reverse()) {
      const [a, z] = wallCoords(d.wall, lx, ly), bb = HH.decoBounds(d);
      if (a >= 0 && a >= bb.a0 && a <= bb.a1 && z >= bb.z0 && z <= bb.z1) return d;
    }
    return null;
  }
  const wallOf = (lx) => (lx >= HH.view.ox ? 'R' : 'L');
  // slide a wall item so the grab point «g» (from its left edge as seen, and from its bottom) sits at (a, z)
  function moveDeco(d, wall, a, z, g) {
    const bb = HH.decoBounds(d), w = bb.a1 - bb.a0, h = bb.z1 - bb.z0, len = wall === 'R' ? W : H;
    let a0 = wall === 'R' ? a - g.u : a + g.u - w;
    a0 = Math.round(Math.max(0.05, Math.min(len - w - 0.05, a0)) * 16) / 16;
    const z0 = Math.round(Math.max(0, Math.min(room.WH - 1 - h, z - g.v)));
    const da = a0 - bb.a0, dz = d.kind === 'chroma' ? 0 : z0 - bb.z0;
    d.wall = wall; d.a0 += da; if (d.a1 != null) d.a1 += da;
    d.z0 += dz; if (d.z1 != null) d.z1 += dz;
  }

  // can this piece of furniture stand where it is now?
  function canPlace(f) {
    if (f.x < 0 || f.y < 0 || f.x + f.w > W || f.y + f.d > H) return false;
    if (!blocks(f)) return true;
    const doorT = new Set(room.doors.map((d) => HH.doorTile(d).join(',')));
    for (let j = 0; j < f.d; j++) for (let i = 0; i < f.w; i++) {
      const x = f.x + i, y = f.y + j;
      if (doorT.has(x + ',' + y)) return false;
      if (room.furniture.some((o) => o !== f && blocks(o) && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.d)) return false;
      if (actors.some((a) => !a.held && !(a.sitting && a.sitting.f === f) && ((a.tx === x && a.ty === y) || (a.path[0] && a.path[0][0] === x && a.path[0][1] === y)))) return false;
    }
    return true;
  }
  function footprint(f, ok) {
    const c = ok ? '#51cf66' : '#ff6b6b';
    for (let j = 0; j < f.d; j++) for (let i = 0; i < f.w; i++) if (inside(f.x + i, f.y + j)) HH.drawTileHighlight(b, f.x + i, f.y + j, c);
  }
  // furniture moved: whoever was going to walk through it stops after this step and decides again
  function furnitureChanged() {
    computeBlocked(); saveLayout(room); standUpOrphans();
    for (const a of actors) if (a.path.some(([x, y]) => blocked[y][x])) { a.path = a.prog > 0 ? [a.path[0]] : []; a.onArrive = null; }
  }
  function nearestFree(x, y) {
    if (free(x, y) && !actors.some((o) => !o.held && o.tx === x && o.ty === y)) return [x, y];
    for (let r = 1; r < Math.max(W, H); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((Math.abs(dx) === r || Math.abs(dy) === r) && free(nx, ny) && !actors.some((o) => !o.held && o.tx === nx && o.ty === ny)) return [nx, ny];
    }
    return [x, y];
  }

  // ---------- dragging: people (by the head), furniture, wall items ----------
  const DRAG_PX = 6, LIFT = 10, HEAD_Y = 5; // css px before a press is a drag · how high a held avatar floats · where on the sprite the hand pinches
  let press = null, drag = null, suppressUntil = 0, placing = null;
  // edit mode (per room, ✏️ in the header): only then do furniture and wall items move. sel = what's selected,
  // chip = a short info bubble in normal mode (a rack telling which device it is)
  let editing = false, sel = null, chip = null;
  function startDrag(p, lx, ly) {
    if (p.kind === 'actor') {
      const a = p.a; if (a.leaving || a.fadeOut) return;
      a.held = true; a.sitting = null; a.path = []; a.prog = 0; a.onArrive = null; a.bubble = null; a.dropZ = 0; a.vz = 0;
      drag = { kind: 'actor', a, px: lx, py: ly, hx: lx, vx: 0, th: 0, om: 0, tile: [a.tx, a.ty], okTile: true, lift: LIFT };
      swing(drag, 16);
    } else if (p.kind === 'furni') {
      const f = p.f, t = tileAt(p.lx, p.ly);
      sel = f; chip = null; buildTool();
      drag = { kind: 'furni', f, from: [f.x, f.y], off: [f.x - t[0], f.y - t[1]], ok: true };
    } else {
      const d = p.d, bb = HH.decoBounds(d), [a, z] = wallCoords(d.wall, p.lx, p.ly);
      sel = d; chip = null; buildTool();
      drag = { kind: 'deco', d, from: JSON.stringify(d), g: { u: d.wall === 'R' ? a - bb.a0 : bb.a1 - a, v: z - bb.z0 } };
    }
    selected = null; hover = null; canvas.style.cursor = 'grabbing';
  }
  function moveDrag(lx, ly) {
    if (drag.kind === 'actor') { drag.px = lx; drag.py = ly; return; }
    if (drag.kind === 'furni') {
      const f = drag.f, t = tileAt(lx, ly);
      f.x = Math.max(0, Math.min(W - f.w, t[0] + drag.off[0])); f.y = Math.max(0, Math.min(H - f.d, t[1] + drag.off[1]));
      drag.ok = canPlace(f); return;
    }
    const wall = wallOf(lx), [a, z] = wallCoords(wall, lx, ly);
    moveDeco(drag.d, wall, a, z, drag.g);
  }
  function endDrag() {
    const g = drag; drag = null; suppressUntil = performance.now() + 400;
    if (g.kind === 'actor') {
      const a = g.a, [x, y] = nearestFree(...g.tile), sp = spotOf(a.cfg.id);
      a.held = false; a.tx = a.fx = x; a.ty = a.fy = y; a.path = []; a.prog = 0;
      a.dropZ = Math.max(2, Math.min(80, g.lift)); a.vz = 0; setDir(a, 0, 1);
      a.idleUntil = performance.now() + 15000;
      if (!a.isPlayer) { room.spots = room.spots || {}; room.spots[a.cfg.id] = [x, y, sp ? sp[2] : 0, sp ? sp[3] : 1]; saveLayout(room); } // his new spot in this room
    } else if (g.kind === 'furni') {
      if (!g.ok) [g.f.x, g.f.y] = g.from; // didn't fit: back where it was
      furnitureChanged();
    } else saveLayout(room);
  }
  // pendulum hanging from the pointer: θ'' = −(G/L)·sin θ − c·θ' − ((aₓ + k·vₓ)/L)·cos θ
  // aₓ = how hard the hand accelerates (the kick), k·vₓ = air drag (moving, the body trails behind)
  function swing(g, dt) {
    const s = Math.max(1, dt) / 1000, raw = (g.px - g.hx) / s;
    g.hx = g.px;
    const vx = g.vx + (raw - g.vx) * Math.min(1, s * 14); // smoothed: pointer events and frames don't line up
    const ax = Math.max(-20000, Math.min(20000, (vx - g.vx) / s));
    g.vx = vx;
    const L = 22, G = 700;
    g.om += (-(G / L) * Math.sin(g.th) - 2.6 * g.om - ((ax + 0.35 * vx) / L) * Math.cos(g.th)) * s;
    g.th = Math.max(-1.45, Math.min(1.45, g.th + g.om * s));
    const feetX = g.px + Math.sin(g.th) * (HH.SPRITE.footY - HEAD_Y), feetY = g.py + Math.cos(g.th) * (HH.SPRITE.footY - HEAD_Y);
    const [wx, wy] = HH.unproject(feetX, feetY + LIFT), t = [Math.max(0, Math.min(W - 1, Math.floor(wx))), Math.max(0, Math.min(H - 1, Math.floor(wy)))];
    g.tile = t; g.okTile = free(t[0], t[1]);
    g.lift = HH.P(t[0] + 0.5, t[1] + 0.5)[1] - feetY;
  }

  // ---------- placing something from the inventory (or picked up with «Mover») ----------
  function startPlacing(item, putBack) {
    placing = { item, putBack, ghost: null, ok: false };
    closeAllSheets(); setHint();
  }
  function cancelPlacing() {
    if (!placing) return;
    if (placing.putBack) { placing.putBack(); furnitureChanged(); }
    placing = null; renderHeader();
  }
  function updateGhost(lx, ly) {
    const it = placing.item;
    if (it.type) {
      const t = tileAt(lx, ly), w = it.w || 1, d = it.d || 1;
      placing.ghost = HH.makeFurni(it, Math.max(0, Math.min(W - w, t[0] - Math.floor((w - 1) / 2))), Math.max(0, Math.min(H - d, t[1] - Math.floor((d - 1) / 2))));
      placing.ok = inside(t[0], t[1]) && canPlace(placing.ghost);
    } else {
      const wall = wallOf(lx), [a, z] = wallCoords(wall, lx, ly), gd = HH.makeDeco(it, wall, 0), bb = HH.decoBounds(gd);
      moveDeco(gd, wall, a, z, { u: (bb.a1 - bb.a0) / 2, v: (bb.z1 - bb.z0) / 2 });
      placing.ghost = gd; placing.ok = a >= 0 && a <= (wall === 'R' ? W : H) && z >= 0 && z <= room.WH + 6;
    }
  }
  function placeGhost() {
    const g = placing.ghost;
    if (!g || !placing.ok) { setHint('Ahí no cabe: prueba en otro sitio'); return; }
    if (g.type) { room.furniture.push(g); furnitureChanged(); } else { (room.decos = room.decos || []).push(g); saveLayout(room); }
    marker = g.type ? { x: g.x, y: g.y, until: performance.now() + 700 } : null;
    placing = null; renderHeader();
  }

  // ---------- pointer ----------
  const fingers = new Map(); let pinch = null, panPress = null, panning = false;
  const pinchInfo = () => { const [a, b] = [...fingers.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid: stageXY((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; };
  canvas.addEventListener('pointerdown', (e) => {
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (fingers.size === 2 && !drag) { // second finger: this is a pinch, forget the press
      if (press) clearTimeout(press.timer);
      press = null; panPress = null; panning = false;
      const p = pinchInfo(); pinch = { d0: p.d, z0: zoom, mid: p.mid };
      return;
    }
    if (fingers.size > 2 || pinch) return;
    if (e.button !== 0) return;
    const [lx, ly] = toLogical(e);
    panPress = { x0: e.clientX, y0: e.clientY, px: panX, py: panY, id: e.pointerId };
    if (placing) return;
    if (bubbleAt(lx, ly)) return;
    const a = actorAt(lx, ly);
    let target = a && !a.leaving ? { kind: 'actor', a } : null;
    if (!target) { const f = furniAt(lx, ly, true); if (f) target = { kind: 'furni', f }; }
    if (!target && !doorAt(lx, ly, null)) { const d = decoAt(lx, ly); if (d) target = { kind: 'deco', d }; }
    if (target && target.kind !== 'actor' && !editing) target = null; // outside edit mode, furniture stays put
    if (!target) return;
    press = { ...target, x0: e.clientX, y0: e.clientY, lx, ly, id: e.pointerId, touch: e.pointerType === 'touch' };
    press.instant = !press.touch || target.kind !== 'actor'; // mouse, or a finger on furniture in edit mode: drag as soon as it moves
    if (press.instant) { panPress = null; return; }
    // finger (docs/uxui touch.md): picking something up needs a hold; sliding before that pans the view
    const held = press;
    press.timer = setTimeout(() => {
      if (press !== held || drag || panning || pinch) return;
      panPress = null; startDrag(held, held.lx, held.ly);
      if (drag) { try { canvas.setPointerCapture(held.id); } catch { /* ignore */ } if (navigator.vibrate) navigator.vibrate(12); }
    }, 350);
  });
  let lastPtr = null, hoverFurni = null;
  canvas.addEventListener('pointermove', (e) => {
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && fingers.size === 2) {
      const p = pinchInfo();
      zoomAt(pinch.z0 * (p.d / pinch.d0), ...p.mid);
      panX += p.mid[0] - pinch.mid[0]; panY += p.mid[1] - pinch.mid[1]; pinch.mid = p.mid;
      layoutZoom(); return;
    }
    if (panPress && !panning && !drag && Math.hypot(e.clientX - panPress.x0, e.clientY - panPress.y0) > DRAG_PX) {
      if (press) { clearTimeout(press.timer); press = null; } // slid before the hold: it was a pan
      panning = true; hover = null; canvas.style.cursor = 'grabbing';
      try { canvas.setPointerCapture(panPress.id); } catch { /* ignore */ }
    }
    if (panning) { panX = panPress.px + e.clientX - panPress.x0; panY = panPress.py + e.clientY - panPress.y0; layoutZoom(); return; }
    const [lx, ly] = toLogical(e);
    lastPtr = [lx, ly];
    if (press && press.instant && !drag && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > DRAG_PX) {
      startDrag(press, press.lx, press.ly);
      if (drag) try { canvas.setPointerCapture(press.id); } catch { /* ignore */ }
    }
    if (drag) { moveDrag(lx, ly); return; }
    if (placing) { updateGhost(lx, ly); hover = null; canvas.style.cursor = placing.ok ? 'copy' : 'not-allowed'; return; }
    // what's in front wins: hovering a person or a piece of furniture never lights the tile behind it
    const a = actorAt(lx, ly), f = !a && furniAt(lx, ly, false), t = tileAt(lx, ly);
    hoverFurni = f || (!a && furniAt(lx, ly, true)) || null;
    if (a && !a.isPlayer) { if (tipA !== a || tipUntil) showTip(a, 0); } else if (tipA && !tipUntil) hideTip();
    hover = !editing && !a && !f && inside(t[0], t[1]) ? t : null;
    const door = doorAt(lx, ly, null), dk = !a && !f && !door && decoAt(lx, ly);
    const onMat = hover && room.furniture.some((o) => o.action === 'call' && hover[0] >= o.x && hover[0] < o.x + o.w && hover[1] >= o.y && hover[1] < o.y + o.d);
    const thing = f || dk || (editing && hoverFurni);
    canvas.style.cursor = a || (editing && thing) ? 'grab' : f && f.notebook ? 'zoom-in' : thing || onMat || (!editing && door) || bubbleAt(lx, ly) || (hover && free(...hover)) ? 'pointer' : 'default';
  });
  const release = (e) => {
    fingers.delete(e.pointerId);
    if (pinch) { if (fingers.size < 2) { pinch = null; suppressUntil = performance.now() + 400; } return; }
    if (panning) { panning = false; suppressUntil = performance.now() + 400; canvas.style.cursor = 'default'; }
    if (press) clearTimeout(press.timer);
    panPress = null; press = null; if (drag) endDrag();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { hover = null; hoverFurni = null; if (placing) placing.ghost = null; if (tipA && !tipUntil) hideTip(); });
  canvas.addEventListener('contextmenu', (e) => { if (placing) { e.preventDefault(); cancelPlacing(); } });

  let lastTap = { t: 0, x: -1, y: -1 };
  canvas.addEventListener('click', (e) => {
    if (performance.now() < suppressUntil) return; // that was the end of a drag
    const [lx, ly] = toLogical(e);
    if (placing) { updateGhost(lx, ly); placeGhost(); return; }
    if (editing) { // edit mode: a tap selects (or lets go); nothing walks, no door opens
      const a = actorAt(lx, ly);
      if (a && a.cfg.dummy) { showTip(a, 6000); return; }
      if (a && !a.isPlayer) { openCard(a.cfg); return; }
      const f = furniAt(lx, ly, true), d = !f && decoAt(lx, ly);
      select(f || d || null); return;
    }
    const bub = bubbleAt(lx, ly);
    if (bub) { HH.TTS && HH.TTS.speak(bub.cfg, bub.bubble.text); return; }
    const a = actorAt(lx, ly);
    if (a && a.cfg.dummy) { showTip(a, 6000); return; } // a dummy has no card: what it's doing is all there is
    if (a && !a.isPlayer) { openCard(a.cfg); return; }
    const matUnder = (x, y) => room.furniture.find((o) => o.action === 'call' && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.d);
    if (a && a.isPlayer && !a.path.length && matUnder(a.tx, a.ty)) { openCall(); return; } // standing on the felpudo
    if (a && a.isPlayer) { say(player, pick(['¡Hola, equipo!', '¿Qué hacemos hoy?', 'Bienvenidos a la oficina.', 'Aquí mando yo. ✨'])); return; }
    const f = furniAt(lx, ly, false);
    if (f && f.notebook) { face(player, { tx: f.x, ty: f.y }); openBook(f.notebook); return; }
    if (f && isSeat(f)) { sitDown(player, f); return; }
    if (f && f.type === 'arcade') { walkNear(f); player.onArrive = () => { face(player, { tx: f.x, ty: f.y }); say(player, pick(['🕹️ ¡Una partidita!', '👾 Récord: 9.999', '🪙 Insert coin…'])); }; return; }
    if (f) { if (f._dev !== undefined) showChip(f); walkNear(f); return; } // a rack tells its device; anything else: go up to it
    const t = tileAt(lx, ly);
    const mat = matUnder(t[0], t[1]);
    if (mat) { if (!(player.tx === t[0] && player.ty === t[1])) goTo(player, t[0], t[1]); openCall(); return; }
    const d = doorAt(lx, ly, t);
    if (d) { useDoor(d); return; }
    const [tx, ty] = t;
    if (!free(tx, ty)) return;
    const now = performance.now();
    if (now - lastTap.t < 350 && lastTap.x === tx && lastTap.y === ty) { // double tap = teleport (omnipotent)
      player.path = []; player.prog = 0; player.tx = player.fx = tx; player.ty = player.fy = ty;
      sparkle = { x: tx, y: ty, until: now + 600 };
      lastTap.t = 0; return;
    }
    lastTap = { t: now, x: tx, y: ty };
    if (goTo(player, tx, ty)) marker = { x: tx, y: ty, until: now + 700 };
  });

  // ---------- rotating (R, or 🔄 in its menu / while placing) ----------
  // a turn swaps the footprint (w ↔ d) and flips `rot`; gfx.js draws it mirrored across the diagonal
  // seats go round all 4 ways: (rot 0) → (rot 1) → (rot 0, flip) → (rot 1, flip); the rest has 2
  const turned = (o) => {
    const t = { ...o, w: o.d, d: o.w, rot: o.rot ? 0 : 1 };
    if (SEAT_Z[o.type] != null && o.rot) t.flip = !o.flip;
    if (!t.flip) delete t.flip;
    return t;
  };
  function rotateFurni(f) {
    const keep = { x: f.x, y: f.y, w: f.w, d: f.d, rot: f.rot };
    Object.assign(f, turned(f)); if (!f.rot) delete f.rot;
    f.x = Math.max(0, Math.min(W - f.w, f.x)); f.y = Math.max(0, Math.min(H - f.d, f.y));
    if (!canPlace(f)) { Object.assign(f, keep); if (!keep.rot) delete f.rot; flashHint('Girado no cabe ahí'); return false; }
    furnitureChanged(); return true;
  }
  function rotatePlacing() {
    if (!placing || !placing.item.type) return;
    placing.item = turned(placing.item);
    if (lastPtr) updateGhost(...lastPtr);
    setHint();
  }
  // a wall item «turns» by going to the other wall, at the same place along it
  function flipDeco(d) {
    const bb = HH.decoBounds(d), w = bb.a1 - bb.a0, wall = d.wall === 'R' ? 'L' : 'R', len = wall === 'R' ? W : H;
    const shift = Math.max(0.05, Math.min(len - w - 0.05, bb.a0)) - bb.a0;
    d.wall = wall; d.a0 += shift; if (d.a1 != null) d.a1 += shift;
    saveLayout(room);
  }
  function flashHint(msg) {
    const h = document.getElementById('hint');
    if (placing) { setHint(msg); setTimeout(() => placing && setHint(), 1400); return; }
    h.textContent = msg; setTimeout(() => { if (h.textContent === msg) renderHeader(); }, 1400);
  }
  window.addEventListener('keydown', (e) => {
    if ((e.key !== 'r' && e.key !== 'R') || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
    if (drag && drag.kind === 'furni') { const f = drag.f; Object.assign(f, turned(f)); if (!f.rot) delete f.rot; f.x = Math.max(0, Math.min(W - f.w, f.x)); f.y = Math.max(0, Math.min(H - f.d, f.y)); drag.ok = canPlace(f); return; }
    if (drag && drag.kind === 'deco') return;
    if (placing) { placing.item.type ? rotatePlacing() : null; return; }
    if (!editing) return;
    const t = sel || hoverFurni;
    if (t && t.type) rotateFurni(t); else if (t && t.kind) flipDeco(t);
    buildTool();
  });
  window.addEventListener('keydown', (e) => { // Supr / ⌫ puts the selected thing away
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || !editing || !sel || placing || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
    e.preventDefault(); store(sel);
  });

  // ---------- edit mode: select → floating toolbar over the thing (no dialogs) ----------
  const labelOf = (o) => {
    const c = HH.CATALOG, hit = o.type ? c.floor.find((i) => i.type === o.type && (i.item || null) === (o.item || null) && (i.style || null) === (o.style || null)) || c.floor.find((i) => i.type === o.type) : c.wall.find((i) => i.kind === o.kind);
    return hit ? hit.label : o.type || o.kind;
  };
  const editBtn = document.getElementById('editBtn'), tool = document.getElementById('tool');
  function setEditing(on) {
    editing = on;
    if (!on) { cancelPlacing(); sel = null; }
    chip = null; hover = null; buildTool(); renderHeader();
  }
  editBtn.addEventListener('click', () => setEditing(!editing));
  function select(o) { sel = o; chip = null; buildTool(); }
  function store(o) {
    const list = o.type ? room.furniture : room.decos, i = list.indexOf(o);
    if (i >= 0) list.splice(i, 1);
    if (o.type) furnitureChanged(); else saveLayout(room);
    select(null);
  }
  function duplicate(o) {
    if (o.type) { const { x, y, ...item } = bare(o); startPlacing(item); }
    else startPlacing({ ...(HH.CATALOG.wall.find((w) => w.kind === o.kind) || {}), ...decoProps(o) });
    select(null);
  }
  // a wall item back into catalog shape, keeping its own size and colours
  function decoProps(d) {
    const { wall, a0, a1, z0, z1, ...rest } = d;
    return { ...rest, aw: a1 != null ? a1 - a0 : 0, zh: z1 != null ? z1 - z0 : 0, z0 };
  }
  function buildTool() {
    tool.innerHTML = ''; tool.className = 'tool';
    const btn = (icon, label, fn) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = icon; x.title = label; x.setAttribute('aria-label', label); x.onclick = (e) => { e.stopPropagation(); fn(); }; tool.appendChild(x); };
    if (editing && sel) {
      const n = document.createElement('span'); n.className = 't-name'; n.textContent = labelOf(sel); tool.appendChild(n);
      if (sel.type) btn('🔄', 'Girar (R)', () => { rotateFurni(sel); buildTool(); });
      else btn('↔️', 'A la otra pared (R)', () => flipDeco(sel));
      btn('📋', 'Duplicar', () => duplicate(sel));
      btn('🎒', 'Guardar en el inventario (Supr)', () => store(sel));
      btn('✕', 'Soltar', () => select(null));
    } else if (chip) {
      const d = chip.f._dev;
      tool.classList.add('is-info'); if (d && !d.up) tool.classList.add('is-down');
      tool.textContent = d ? `${d.up ? '🟢' : '🔴'} ${devLine(d)}` : '🖥 Rack vacío · en ✏️ Editar puedes poner más racks: cada uno, un dispositivo más';
    }
  }
  function showChip(f) { chip = { f, until: performance.now() + 5000 }; buildTool(); }
  // keep the toolbar over its thing every frame (it follows zoom, pan and drags)
  function placeTool(now) {
    if (chip && now > chip.until) { chip = null; buildTool(); }
    const o = (editing && sel) || (chip && chip.f);
    if (!o || (editing && !room.furniture.includes(o) && !(room.decos || []).includes(o))) { tool.hidden = true; return; }
    let p;
    if (o.type) p = HH.P(o.x + o.w / 2, o.y + o.d / 2, o.floor ? 6 : o.type === 'rack' ? 64 : 34);
    else { const bb = HH.decoBounds(o); p = HH.wp(o.wall, (bb.a0 + bb.a1) / 2, bb.z1 + 3); }
    tool.hidden = false;
    const w = tool.offsetWidth, h = tool.offsetHeight, sw = stage.clientWidth;
    const x = clampN(canvas.offsetLeft + p[0] * cssScale, w / 2 + 4, sw - w / 2 - 4), y = Math.max(h + 10, canvas.offsetTop + p[1] * cssScale);
    tool.style.left = Math.round(x) + 'px'; tool.style.top = Math.round(y) + 'px';
  }
  // normal mode, tapping furniture: walk up to it (the free tile next to it closest to the player)
  function walkNear(f) {
    let best = null;
    for (let j = -1; j <= f.d; j++) for (let i = -1; i <= f.w; i++) {
      const x = f.x + i, y = f.y + j;
      if ((i >= 0 && i < f.w && j >= 0 && j < f.d) || !free(x, y)) continue;
      const dist = Math.hypot(x - player.tx, y - player.ty);
      if (!best || dist < best[2]) best = [x, y, dist];
    }
    if (best && goTo(player, best[0], best[1])) { marker = { x: best[0], y: best[1], until: performance.now() + 700 }; player.onArrive = () => face(player, { tx: f.x, ty: f.y }); }
  }
  function resetRoom() {
    resetLayout(room); select(null);
    for (const a of actors) if (!a.isPlayer) { const sp = spotOf(a.cfg.id); if (sp) { const [x, y] = nearestFree(sp[0], sp[1]); a.tx = a.fx = x; a.ty = a.fy = y; a.path = []; a.prog = 0; setDir(a, sp[2], sp[3]); } }
    const [px, py] = nearestFree(player.tx, player.ty); player.tx = player.fx = px; player.ty = player.fy = py; player.path = [];
    attachDevices();
  }

  // ---------- doors ----------
  function walkThen(d, fn) {
    const [dx, dy] = HH.doorTile(d);
    if (player.tx === dx && player.ty === dy && !player.path.length) return fn();
    if (goTo(player, dx, dy)) { player.onArrive = fn; marker = { x: dx, y: dy, until: performance.now() + 700 }; } else fn();
  }
  const pop = document.getElementById('doorpop');
  function useDoor(d) { walkThen(d, () => { openDoor(d); setTimeout(() => enterRoom(d.to, room.id), 250); }); }
  pop.addEventListener('click', (e) => { if (e.target === pop) pop.hidden = true; });

  // ---------- card ----------
  const card = document.getElementById('card');
  let cardM = null;
  const ago = (at) => { const m = Math.round((Date.now() - new Date(at).getTime()) / 60000); return !at || isNaN(m) ? '' : m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  // what an agent is up to, in one or two lines (from ~/.claude, read by scripts/serve.mjs)
  function nowLines(id) {
    const a = agentOf(id);
    if (!a) return ['☕ Libre', 'Sin encargos de Claude Code esta semana'];
    if (a.working) return [`⌨️ ${a.task || a.label}`, a.doing ? `${a.doing} · ${ago(a.at)}` : ''];
    return ['☕ Libre', `Lo último: ${a.task || a.label}${a.at ? ' · ' + ago(a.at) : ''}`];
  }
  function openCard(m) {
    cardM = m; selected = actorOf(m.id) || null;
    card.querySelector('.c-emoji').textContent = m.emoji;
    card.querySelector('.c-name').textContent = m.name;
    card.querySelector('.c-role').textContent = m.role + ' · ' + locLabel(presence[m.id]);
    card.querySelector('.c-now').textContent = nowLines(m.id).filter(Boolean).join(' — ');
    card.querySelector('.c-pers').textContent = m.personality;
    card.querySelector('.c-lleva').textContent = m.lleva;
    const deptR = ROOMS[DEPT[m.id]];
    card.querySelector('.c-room').textContent = deptR ? `${deptR.emoji} ${deptR.name}` : '—';
    card.querySelector('.c-folder').textContent = m.folder;
    card.querySelector('.c-agent').textContent = '@' + m.agent;
    const q = pick(m.phrases).replace(/[«»]/g, '');
    const qe = card.querySelector('.c-quote'); qe.textContent = '«' + q + '»'; qe.dataset.text = q;
    card.style.setProperty('--accent', m.accent);
    const pc = card.querySelector('.c-portrait'), p = pc.getContext('2d');
    p.imageSmoothingEnabled = false; p.clearRect(0, 0, pc.width, pc.height);
    p.drawImage(HH.avatarSprite(m.id, m.look, 'front', 0), 0, 0, HH.SPRITE.W, HH.SPRITE.H, 0, 0, pc.width, pc.height);
    // actions depend on where he is and where you are (the player can always do anything)
    const acts = card.querySelector('.c-acts'); acts.innerHTML = '';
    const btn = (label, fn, cls) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'c-call ' + (cls || ''); x.textContent = label; x.onclick = () => { closeCard(); fn(); }; acts.appendChild(x); };
    const a = actorOf(m.id), dept = DEPT[m.id];
    if (a && !a.leaving) btn('Que venga aquí', () => comeHere(a));
    else btn(`🔔 Que venga a ${room.id === 'main' ? 'el lobby' : room.mine ? 'mi despacho' : room.name}`, () => setWhere(m.id, room.id));
    if (presence[m.id] !== HOME && !room.mine) btn('🏠 A mi despacho', () => setWhere(m.id, HOME), 'ghost');
    if (where[m.id]) btn('↩︎ Que vuelva a lo suyo', () => setWhere(m.id, null), 'ghost');
    if (presence[m.id] !== 'away') btn('👋 Que se vaya', () => setWhere(m.id, 'away'), 'ghost');
    if (todoIds.has(m.id)) btn('📓 Su libreta', () => openBook(m.id), 'ghost');
    if (dept && room.id !== dept) btn(`Ir a ${ROOMS[dept].emoji} ${ROOMS[dept].name}`, () => goDept(m), 'ghost');
    card.hidden = false;
    if (a) { face(a, player); if (!a.bubble) say(a, q); }
  }
  function comeHere(a) {
    const spot = randomFreeNear([player.tx, player.ty], 1);
    if (spot && goTo(a, spot[0], spot[1])) a.onArrive = () => { face(a, player); face(player, a); say(a, pick(a.cfg.phrases), { speak: HH.TTS && HH.TTS.opts.chat }); };
  }
  function goDept(m) {
    const dept = DEPT[m.id], d = room.id === 'main' && room.doors.find((x) => x.to === dept);
    if (d) walkThen(d, () => { openDoor(d); setTimeout(() => enterRoom(dept, 'main'), 250); });
    else enterRoom(dept, room.id); // omnipotent shortcut
  }
  function closeCard() { card.hidden = true; selected = null; }
  card.querySelector('.c-close').addEventListener('click', closeCard);
  card.addEventListener('click', (e) => { if (e.target === card) closeCard(); });
  card.querySelector('.c-listen').addEventListener('click', () => { if (cardM && HH.TTS) HH.TTS.speak(cardM, card.querySelector('.c-quote').dataset.text); });
  function closeAllSheets() { closeCard(); pop.hidden = true; who.hidden = true; inv.hidden = true; book.hidden = true; const v = document.getElementById('voices'); if (v) v.hidden = true; }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const wasPlacing = !!placing;
    closeAllSheets(); cancelPlacing();
    if (!wasPlacing) { if (sel) select(null); else if (editing) setEditing(false); }
  });

  // ---------- header + roster ----------
  const title = document.getElementById('roomtitle'), backBtn = document.getElementById('back'), homeBtn = document.getElementById('homeBtn');
  // 🏠 = straight to the player's office, from anywhere (omnipotent: no walking)
  homeBtn.addEventListener('click', () => {
    const home = Object.values(ROOMS).find((r) => r.mine);
    if (!home || room === home) return;
    sparkle = { x: player.tx, y: player.ty, until: performance.now() + 600 };
    setTimeout(() => enterRoom(home.id, room.id), 220);
  });
  function renderHeader() {
    const isMain = room.id === 'main';
    document.getElementById('hint').classList.remove('is-placing');
    title.textContent = room.emoji + ' ' + room.name;
    backBtn.hidden = isMain;
    homeBtn.classList.toggle('is-on', !!room.mine);
    editBtn.classList.toggle('is-on', editing);
    editBtn.innerHTML = editing ? '✓<span class="wide"> Listo</span>' : '✏️<span class="wide"> Editar</span>';
    document.getElementById('hint').classList.toggle('is-editing', editing);
    if (editing) {
      const h = document.getElementById('hint'); h.textContent = '✏️ Editando esta sala: arrastra muebles y cuadros · toca uno para girarlo, duplicarlo o guardarlo ';
      const add = document.createElement('button'); add.type = 'button'; add.className = 'h-btn'; add.textContent = '🎒 Añadir'; add.onclick = openInv;
      const rs = document.createElement('button'); rs.type = 'button'; rs.className = 'h-btn'; rs.textContent = '↺ Como venía'; rs.onclick = resetRoom;
      h.append(add, ' ', rs);
      return;
    }
    const team = MAESTROS.filter((x) => DEPT[x.id] === room.id).map((x) => x.name).join(', ');
    document.getElementById('hint').textContent = isMain
      ? 'Aquí está quien no trabaja · el que se pone a trabajar se va a su mesa · pasa por encima de alguien para ver en qué anda'
      : room.mine ? 'Tu despacho · toca el felpudo 🔔 para llamar a alguien · la libreta de la mesa es tu TODO'
        : `${room.name}: ${team || 'las mesas libres'}${room.hot ? ' · los maniquíes 🟨 son agentes sin alma' : ''} · pasa por encima para ver en qué trabajan`;
  }
  // while placing, the hint says what and how to cancel (a button: on a phone there is no Escape)
  function setHint(msg) {
    const h = document.getElementById('hint');
    if (!placing) { h.classList.remove('is-placing'); return; }
    const it = placing.item;
    h.classList.add('is-placing'); h.textContent = '';
    h.append(msg || `Colocando «${it.label || labelOf(it)}»: toca ${it.type ? 'el suelo' : 'una pared'} `);
    if (it.type) { const r = document.createElement('button'); r.type = 'button'; r.className = 'h-btn'; r.textContent = '🔄 Girar (R)'; r.onclick = rotatePlacing; h.append(' ', r); }
    const x = document.createElement('button'); x.type = 'button'; x.className = 'h-btn'; x.textContent = '✕ Cancelar';
    x.onclick = cancelPlacing; h.append(' ', x);
  }
  backBtn.addEventListener('click', () => { const d = room.doors[0]; walkThen(d, () => { openDoor(d); setTimeout(() => enterRoom('main', room.id), 200); }); });
  const roster = document.getElementById('roster');
  function renderRoster() {
    roster.innerHTML = '';
    for (const m of MAESTROS) {
      const bt = document.createElement('button');
      const here = !!actorOf(m.id);
      bt.className = 'chip' + (here ? '' : ' is-out');
      bt.textContent = m.emoji + ' ' + m.name;
      bt.title = locLabel(presence[m.id]) + (workingNow(m.id) ? ' · trabajando' : '');
      if (workingNow(m.id)) bt.textContent += ' ⌨️';
      bt.style.setProperty('--accent', m.accent);
      bt.addEventListener('click', () => openCard(m));
      roster.appendChild(bt);
    }
  }

  // ---------- «Quién está» (the player decides where everyone is) ----------
  const who = document.getElementById('who');
  function renderWho() {
    if (who.hidden) return;
    const list = who.querySelector('.w-list'); list.innerHTML = '';
    const OPTS = [['', 'Solo (trabaja → su mesa · libre → lobby)'], ['main', 'En el lobby'], [HOME, 'En mi despacho'], ['away', 'Fuera']];
    for (const m of MAESTROS) {
      const li = document.createElement('li'); li.style.setProperty('--accent', m.accent);
      li.innerHTML = `<span class="w-n"><b></b><small></small></span><select aria-label="Dónde está ${m.name}"></select>`;
      li.querySelector('b').textContent = m.emoji + ' ' + m.name + (workingNow(m.id) ? ' ⌨️' : '');
      li.querySelector('small').textContent = locLabel(presence[m.id]) + ' · ' + nowLines(m.id)[0];
      const sel = li.querySelector('select');
      for (const [v, l] of OPTS) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
      sel.value = where[m.id] || '';
      sel.addEventListener('change', () => setWhere(m.id, sel.value || null));
      list.appendChild(li);
    }
  }
  document.getElementById('whoBtn').addEventListener('click', () => { who.hidden = false; renderWho(); });
  who.querySelector('.c-close').addEventListener('click', () => { who.hidden = true; });
  who.addEventListener('click', (e) => { if (e.target === who) who.hidden = true; });
  const allWhere = (loc) => { for (const m of MAESTROS) { if (loc) where[m.id] = loc; else delete where[m.id]; } saveWhere(); syncPresence(); };
  who.querySelector('[data-all]').addEventListener('click', () => allWhere(null));
  who.querySelector('[data-none]').addEventListener('click', () => allWhere('away'));
  who.querySelector('[data-caves]').addEventListener('click', () => allWhere('main'));

  // ---------- inventario (everything, free, endless) ----------
  const inv = document.getElementById('inv');
  function thumb(item) {
    const c = document.createElement('canvas'); c.width = 96; c.height = 80;
    const g = c.getContext('2d'), v = HH.view, keep = [v.ox, v.oy], now = performance.now();
    if (item.type) {
      const f = HH.makeFurni(item, 0, 0);
      v.ox = 48 - (f.w - f.d) * 8; v.oy = 60 - (f.w + f.d) * 4;
      for (let j = 0; j < f.d; j++) for (let i = 0; i < f.w; i++) HH.fillPoly(g, [HH.P(i, j), HH.P(i + 1, j), HH.P(i + 1, j + 1), HH.P(i, j + 1)], (i + j) % 2 ? '#e9ecef' : '#dee2e6');
      if (f.floor) HH.drawRug(g, f, now); else HH.drawFurni(g, f, now);
    } else {
      const d = HH.makeDeco(item, 'R', 0), bb = HH.decoBounds(d), am = (bb.a0 + bb.a1) / 2, zm = (bb.z0 + bb.z1) / 2;
      v.ox = 48 - 16 * am; v.oy = 40 - 8 * am + zm;
      (HH.DECO[d.kind] || HH.DECO.poster)(g, d, now, room);
    }
    [v.ox, v.oy] = keep;
    // crop to what was drawn and blow it up by a whole number, so small things read too
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (px[(y * c.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return c;
    const out = document.createElement('canvas'); out.width = 88; out.height = 64;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.max(1, Math.min(3, Math.floor(Math.min(out.width / bw, out.height / bh))));
    const o = out.getContext('2d'); o.imageSmoothingEnabled = false;
    o.drawImage(c, x0, y0, bw, bh, Math.round((out.width - bw * k) / 2), Math.round((out.height - bh * k) / 2), bw * k, bh * k);
    return out;
  }
  let invBuilt = false;
  function buildInv() {
    if (invBuilt) return; invBuilt = true;
    for (const [sel, list] of [['[data-floor]', HH.CATALOG.floor], ['[data-wall]', HH.CATALOG.wall]]) {
      const grid = inv.querySelector(sel);
      for (const item of list) {
        const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'i-item'; bt.title = item.label;
        bt.append(thumb(item), item.label);
        bt.addEventListener('click', () => startPlacing(item));
        grid.appendChild(bt);
      }
    }
  }
  function openInv() { cancelPlacing(); if (!editing) setEditing(true); buildInv(); inv.hidden = false; }
  document.getElementById('invBtn').addEventListener('click', openInv);
  inv.querySelector('.c-close').addEventListener('click', () => { inv.hidden = true; });
  inv.addEventListener('click', (e) => { if (e.target === inv) inv.hidden = true; });
  inv.querySelector('[data-reset]').addEventListener('click', () => { inv.hidden = true; resetRoom(); });

  // ---------- el felpudo: «¿A quién llamas?» (stays open: call several in a row) ----------
  function openCall() {
    const list = MAESTROS;
    pop.querySelector('.p-title').textContent = '🔔 ¿A quién llamas?';
    const acts = pop.querySelector('.p-acts'); acts.innerHTML = '';
    const btn = (label, fn, cls, close) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'p-btn ' + (cls || ''); x.textContent = label; x.onclick = () => { fn(); if (close) pop.hidden = true; else setTimeout(openCall, 0); }; acts.appendChild(x); return x; };
    for (const m of list) {
      const a = actorOf(m.id), here = a && !a.leaving;
      const b = here ? btn(`${m.emoji} ${m.name} · ya está · ↩︎ que vuelva a lo suyo`, () => setWhere(m.id, null), 'ghost')
        : btn(`🔔 ${m.emoji} ${m.name} · ${locLabel(presence[m.id]).toLowerCase()}${workingNow(m.id) ? ' (trabajando)' : ''}`, () => setWhere(m.id, room.id));
      b.style.borderLeft = `6px solid ${m.accent}`;
    }
    if (list.length > 1) {
      btn('🔔 Que vengan todos', () => allWhere(room.id), 'main');
      btn('↩︎ Cada uno a lo suyo', () => allWhere(null), 'ghost');
    }
    btn('Cerrar', () => {}, 'ghost', true);
    pop.hidden = false;
  }

  // ---------- libretas: each maestro with a TODO.md has one; read live from disk, local only (needs a /api/todo on the server) ----------
  // Nothing of it is cached: not in a file, not in localStorage. Served by scripts/serve.mjs on 127.0.0.1.
  const todoIds = new Set();
  const book = document.getElementById('book');
  const local = location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\([^)]*\)/g, '<u>$1</u>');
  function mdToHtml(md) { // just enough markdown for a TODO: headings, checkboxes, lists, quotes, paragraphs
    const out = [];
    for (const raw of md.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
      const line = raw.replace(/\s+$/, ''), ind = (raw.match(/^\s*/)[0].length >> 1);
      let m;
      if (!line.trim()) continue;
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { out.push(`<h${Math.min(4, m[1].length + 1)}>${inline(m[2])}</h${Math.min(4, m[1].length + 1)}>`); continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push('<hr>'); continue; }
      if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) { out.push(`<p class="b-li b-${m[1] === ' ' ? 'open' : 'done'}" style="--ind:${ind}"><i>${m[1] === ' ' ? '☐' : '☑'}</i><span>${inline(m[2])}</span></p>`); continue; }
      if ((m = line.match(/^\s*[-*]\s+(✅.*)$/))) { out.push(`<p class="b-li b-done" style="--ind:${ind}"><i>☑</i><span>${inline(m[1].replace(/^✅\s*/, ''))}</span></p>`); continue; }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { out.push(`<p class="b-li" style="--ind:${ind}"><i>·</i><span>${inline(m[1])}</span></p>`); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
      out.push(`<p>${inline(line.trim())}</p>`);
    }
    return out.join('');
  }
  async function openBook(id) {
    const m = id === PLAYER.id ? PLAYER : HH.byId(id), body = book.querySelector('.b-body');
    book.querySelector('.b-title').textContent = `📓 ${id === PLAYER.id ? 'Tu libreta' : 'La libreta de ' + m.name}`;
    book.style.setProperty('--accent', (m && m.accent) || '#2f9e44');
    book.querySelector('.b-reload').onclick = () => openBook(id);
    book.hidden = false;
    body.innerHTML = '<p class="v-muted"><span class="spin"></span> Leyendo su TODO.md…</p>';
    if (!local) { body.innerHTML = '<p class="v-warn">Las libretas solo se leen en local, en vivo (<code>node scripts/serve.mjs</code>). Así su TODO.md nunca viaja con la sala.</p>'; return; }
    try {
      const r = await fetch('/api/todo/' + encodeURIComponent(id), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 404 ? 'no-todo' : 'http ' + r.status);
      const md = await r.text(), open = (md.match(/^\s*[-*]\s+\[ \]/gm) || []).length, done = (md.match(/^\s*[-*]\s+(\[[xX]\]|✅)/gm) || []).length;
      book.querySelector('.b-count').textContent = `${open} pendientes · ${done} hechas · leída ahora`;
      body.innerHTML = mdToHtml(md);
    } catch (e) {
      book.querySelector('.b-count').textContent = '';
      body.innerHTML = e.message === 'no-todo'
        ? `<p class="v-muted">${m ? m.name : 'Este agente'} no tiene TODO.md (todavía).</p>`
        : '<p class="v-warn">No se ha podido leer. ¿Está corriendo <code>node scripts/serve.mjs</code>?</p>';
    }
  }
  book.querySelector('.c-close').addEventListener('click', () => { book.hidden = true; book.querySelector('.b-body').innerHTML = ''; });
  book.addEventListener('click', (e) => { if (e.target === book) { book.hidden = true; book.querySelector('.b-body').innerHTML = ''; } });

  // whoever has a TODO.md gets a notebook on a little table on their desk
  function giveNotebooks() { // on their own desk, in their department
    for (const id of todoIds) {
      const r = ROOMS[DEPT[id]], c = r && r.desks && r.desks[id];
      if (!c || r.furniture.some((f) => f.notebook === id)) continue;
      const desk = r.furniture.find((f) => f.type === 'workdesk' && f.x + (f.rot ? 1 : 0) === c[0] && f.y + (f.rot ? 0 : 1) === c[1]);
      if (desk) desk.notebook = id;
    }
  }
  if (local) fetch('/api/todo', { cache: 'no-store' }).then((r) => r.json()).then(({ ids }) => { ids.forEach((i) => todoIds.add(i)); giveNotebooks(); }).catch(() => { /* static server: no notebooks to read */ });

  // ---------- the racks: each one is a real device on your network (scripts/serve.mjs pings them) ----------
  let devices = null;
  const racksOf = (r) => r.furniture.filter((f) => f.type === 'rack').sort((p, q) => p.y * 100 + p.x - (q.y * 100 + q.x));
  function attachDevices() {
    for (const r of Object.values(ROOMS)) racksOf(r).forEach((f, i) => { f._dev = devices ? devices[i] || null : undefined; });
  }
  async function pollDevices() {
    if (!location.protocol.startsWith('http')) return;
    try { const r = await fetch('/api/devices', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); devices = (await r.json()).devices; }
    catch { devices = null; }
    attachDevices();
  }
  const wantsDevices = () => room && (room.id === 'main' || racksOf(room).length > 0);
  pollDevices();
  setInterval(() => { if (!document.hidden && wantsDevices()) pollDevices(); }, 15000);
  const devLine = (d) => `${d.name} · ${d.host} · ${d.up ? `en línea${d.ms != null ? ' · ' + d.ms + ' ms' : ''}` : 'no responde'}${d.role ? ' · ' + d.role : ''}`;
  HH.devicesNow = () => devices;

  // ---------- the agents: what Claude Code is doing (scripts/serve.mjs reads ~/.claude; nothing is written there) ----------
  const fakeAgents = [];
  const DUMMY_NAMES = { 'general-purpose': 'Ayudante', Explore: 'Explorador', Plan: 'Planificador', 'claude-code-guide': 'Guía', claude: 'Claude' };
  const dummyName = (a) => { const n = a.kind === 'session' ? a.label || 'Sesión' : DUMMY_NAMES[a.label] || a.label || 'Agente'; return n.length > 18 ? n.slice(0, 17) + '…' : n; };
  const makeDummy = (id, a) => ({ id, spriteId: 'dummy', dummy: true, name: dummyName(a), emoji: '🟨', accent: '#fcc419', stepMs: 260, look: HH.DUMMY_LOOK, phrases: ['…'], activities: [], role: 'Agente sin alma', agentInfo: a });
  async function pollAgents() {
    if (!location.protocol.startsWith('http')) return;
    try { const r = await fetch('/api/agents', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); agentsNow = (await r.json()).agents || []; }
    catch { agentsNow = []; } // a plain static server: everybody free, in the lobby
    // pretend agents (tests, demos): HH.debug.fakeAgents.push({ maestro: 'my-reviewer', working: true, task, doing })
    for (const f of fakeAgents) { const i = agentsNow.findIndex((a) => f.maestro && a.maestro === f.maestro); if (i >= 0) agentsNow[i] = { ...agentsNow[i], ...f }; else agentsNow.push({ key: 'fake-' + (f.maestro || f.label), kind: f.maestro ? 'maestro' : 'dummy', label: f.label || 'Explore', ...f }); }
    const seen = new Set();
    for (const a of agentsNow) { // a dummy for every nameless agent at work
      if (a.maestro || !a.working) continue;
      const id = 'dm-' + a.key; seen.add(id);
      if (!dummies[id]) dummies[id] = makeDummy(id, a);
      dummies[id].agentInfo = a; dummies[id].name = dummyName(a);
    }
    for (const id of Object.keys(dummies)) {
      if (seen.has(id)) continue;
      dummies[id].agentInfo = { ...dummies[id].agentInfo, working: false }; // done: walks out
      if (presence[id] === 'away' && !actorOf(id)) { delete dummies[id]; delete presence[id]; }
    }
    syncPresence(); renderRoster(); renderWho(); refreshTip();
  }
  setInterval(() => { if (!document.hidden) pollAgents(); }, 5000);

  // ---------- hover someone: what they work on / think (desktop); tap a dummy on a phone ----------
  const tip = document.getElementById('tip');
  let tipA = null, tipUntil = 0;
  function showTip(a, ms) { if (!a || a.isPlayer) return; tipA = a; tipUntil = ms ? performance.now() + ms : 0; refreshTip(); }
  function hideTip() { tipA = null; tipUntil = 0; tip.hidden = true; }
  function refreshTip() {
    if (!tipA) return;
    const [l1, l2] = nowLines(tipA.cfg.id), h = document.createElement('b'), a = document.createElement('span'), b2 = document.createElement('small');
    h.textContent = `${tipA.cfg.emoji || ''} ${tipA.cfg.name}`; a.textContent = l1; b2.textContent = l2 || '';
    tip.replaceChildren(h, a, b2); tip.classList.toggle('is-work', workingNow(tipA.cfg.id));
  }
  function placeTip(now) {
    if (tipA && tipUntil && now > tipUntil) tipA = null;
    if (!tipA || !actors.includes(tipA) || !tipA.screen) { tip.hidden = true; return; }
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.round(clampN(canvas.offsetLeft + tipA.screen[0] * cssScale, w / 2 + 4, stage.clientWidth - w / 2 - 4)) + 'px';
    tip.style.top = Math.round(Math.max(h + 8, canvas.offsetTop + (tipA.screen[1] - 44) * cssScale)) + 'px';
  }

  // ---------- the other rooms, live and in miniature, in a row under the big one (tap one to go there) ----------
  const minis = document.getElementById('minis'), mbuf = document.createElement('canvas'); mbuf.width = LW; mbuf.height = LH;
  const mb = mbuf.getContext('2d');
  const MINI_ORDER = HH.ROOM_ORDER || Object.keys(ROOMS);
  let minisAt = 0;
  function renderMinisSoon() { minisAt = 0; }
  function buildMinis() {
    minis.replaceChildren();
    for (const id of MINI_ORDER) {
      const r = ROOMS[id]; if (!r || id === room.id) continue;
      const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'mini'; bt.dataset.room = id;
      bt.style.setProperty('--accent', r.accent || '#868e96');
      const cv = document.createElement('canvas'); cv.width = LW; cv.height = LH;
      bt.append(cv, document.createElement('span'));
      bt.addEventListener('click', () => { sparkle = { x: player.tx, y: player.ty, until: performance.now() + 600 }; setTimeout(() => enterRoom(id, room.id), 160); });
      minis.appendChild(bt);
    }
    minisAt = 0;
  }
  const dirOf = ([dx, dy]) => { const sx = dx - dy, sy = dx + dy, view = sy >= 0 ? 'front' : 'back'; return [view, view === 'front' ? sx < 0 : sx > 0]; };
  const seedOf = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) & 0xffff;
  // paints room r (not the one you're in) with whoever is there: working ones typing at their desk, the rest at their spot
  function drawMini(r, cv, now) {
    const v = HH.view, keep = [v.ox, v.oy];
    v.ox = Math.round(LW / 2 - 8 * (r.W - r.H)); v.oy = Math.round(22 + r.WH + (LH - 31 - r.WH - 8 * (r.W + r.H) - 7) / 2);
    const people = [], hotUsed = [];
    for (const id of Object.keys(presence)) {
      if (presence[id] !== r.id) continue;
      const c = cfgOf(id); if (!c) continue;
      let t = r.desks && r.desks[id];
      if (!t && r.hot && workingNow(id)) { t = r.hot.find((h) => !hotUsed.includes(h)); if (t) hotUsed.push(t); }
      const chair = t && r.furniture.find((f) => SEAT_Z[f.type] != null && t[0] >= f.x && t[0] < f.x + f.w && t[1] >= f.y && t[1] < f.y + f.d);
      if (workingNow(id) && chair) people.push({ c, x: t[0], y: t[1], chair, typing: true });
      else { const sp = (r.spots && r.spots[id]) || idleOf(r, id) || r.spawn || [1, 1]; people.push({ c, x: sp[0], y: sp[1], dir: [sp[2] ?? 0, sp[3] ?? 1] }); }
    }
    lightDesks(r, people.filter((p) => p.typing).map((p) => [p.x, p.y]));
    mb.clearRect(0, 0, LW, LH);
    HH.drawRoom(mb, r, now);
    for (const f of r.furniture) if (f.floor) HH.drawRug(mb, f, now);
    const items = r.furniture.filter((f) => !f.floor).map((f) => ({ k: fk(f), f }));
    for (const p of people) items.push({ k: p.chair && p.chair.flip ? fk(p.chair) - 0.05 : p.x + p.y + 1.01, p });
    items.sort((a, b) => a.k - b.k);
    for (const it of items) {
      if (it.f) { HH.drawFurni(mb, it.f, now); continue; }
      const p = it.p, [sx, sy] = HH.P(p.x + 0.5, p.y + 0.5).map(Math.round);
      let view, mirror, frame = 0;
      if (p.typing) { const s1 = p.chair.flip ? -1 : 1; [view, mirror] = dirOf(p.chair.rot ? [s1, 0] : [0, s1]); frame = frameOf({ typing: true, seed: seedOf(p.c.id) }, now); }
      else { [view, mirror] = dirOf(p.dir); HH.drawShadow(mb, sx, sy); }
      const spr = HH.avatarSprite(p.c.spriteId || p.c.id, p.c.look, view, frame);
      const dx = sx - 13, dy = p.typing ? sy - SEAT_Z[p.chair.type] - 31 : sy - HH.SPRITE.footY;
      if (mirror) { mb.save(); mb.translate(dx + HH.SPRITE.W, dy); mb.scale(-1, 1); mb.drawImage(spr, 0, 0); mb.restore(); } else mb.drawImage(spr, dx, dy);
    }
    [v.ox, v.oy] = keep;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, cv.width, cv.height); g.drawImage(mbuf, 0, 0);
    return people;
  }
  function updateMinis(now) {
    for (const bt of minis.children) {
      const r = ROOMS[bt.dataset.room], people = drawMini(r, bt.firstChild, now), busy = people.filter((p) => p.typing).length;
      bt.lastChild.textContent = `${r.emoji} ${r.name}${busy ? ' · ⌨️ ' + busy : people.length ? ' · ' + people.length : ''}`;
      bt.classList.toggle('is-busy', busy > 0);
      bt.title = people.length ? people.map((p) => p.c.name + (p.typing ? ' ⌨️' : '')).join(', ') : 'Vacía';
    }
  }

  // ---------- voices ----------
  if (HH.TTS) { HH.TTS.bindPanel(); document.getElementById('voicesBtn').addEventListener('click', () => HH.TTS.openPanel()); }

  // ---------- chat (the player gives orders; the team obeys) ----------
  const form = document.getElementById('chat');
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = form.querySelector('input'), text = inp.value.trim();
    if (!text) return; inp.value = '';
    say(player, text);
    const low = norm(text), speakIt = HH.TTS && HH.TTS.opts.chat;
    const named = MAESTROS.find((m) => low.includes(norm(m.name.replace(/^la /i, ''))));
    const all = /\btodos\b/.test(low);
    const out = /\b(vete|fuera|largo|marchad|marcha|idos|adeu|adios)\b/.test(low);
    const come = /\b(ven|venid|aqui|entra|entrad|vine|veniu)\b/.test(low);
    if (all && (out || come)) { allWhere(out ? 'away' : room.id); return; }
    if (named) {
      const a = actorOf(named.id);
      if (out) { if (a) say(a, pick(named.phrases), { speak: speakIt }); setTimeout(() => setWhere(named.id, 'away'), 700); return; }
      if (!a) { setWhere(named.id, room.id); return; } // not here: the player calls them in
      comeHere(a); return;
    }
    const near = actors.filter((a) => !a.isPlayer && !a.leaving).sort((p, q) => Math.hypot(p.tx - player.tx, p.ty - player.ty) - Math.hypot(q.tx - player.tx, q.ty - player.ty))[0];
    if (near) setTimeout(() => { face(near, player); say(near, pick(near.cfg.phrases), { speak: speakIt }); }, 900);
  });

  // ---------- go ----------
  const startRoom = ROOMS[read('hh.room.v1', 'main')] ? read('hh.room.v1', 'main') : 'main';
  enterRoom(startRoom, null);
  resize();
  pollAgents(); // who is working right now
  // battery: the loop stops while the page or the canvas can't be seen
  let last = performance.now(), raf = 0, visible = true;
  function loop(now) {
    const dt = Math.min(100, now - last); last = now;
    update(dt, now); render(now);
    raf = requestAnimationFrame(loop);
  }
  function sync() {
    const on = !document.hidden && visible;
    if (on && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync); window.addEventListener('resize', sync); window.addEventListener('pageshow', sync);
  setInterval(sync, 1000); // cheap safety net: some webviews miss a visibilitychange
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }).observe(canvas);
  render(performance.now()); // first frame right away, even if the loop starts paused
  sync();
  HH.debug = { get actors() { return actors; }, get room() { return room; }, get drag() { return drag; }, get agents() { return agentsNow; }, fakeAgents, dummies, where, syncPresence, setWhere, pollAgents, presence, enterRoom, setPresence, findPath, furniAt, decoAt, canPlace, sitDown, isSeat,
    frame: (dt = 16) => { const now = performance.now(); update(dt, now); render(now); } }; // step the room by hand (tests; a hidden page gets no frames)
})();
