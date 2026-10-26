/* The rooms: an example office. Edit them, or build your own with ✏️ Edit and the 🎒 inventory (what you move
 * is saved in the browser). All of them are on screen at once: the one you're in, big; the rest as live
 * miniatures underneath.
 *
 * Who is where: an agent that is working sits at a desk in its room (HH.DEPT from team.json, or HH.WORK_ROOM)
 * and types; one that is free hangs around the lobby. Agents with no character of their own (Explore,
 * general-purpose, a Claude Code session) are crash-test dummies, only while they work.
 *
 * A room:
 *   W, H, WH        tiles across (x) and deep (y); wall height in px. W + H ≤ 20 (fits the buffer)
 *   floor           tiles · grid · planks · carpet · straw · steel · stage
 *   wallStyle       (optional) bricks · barn · panels
 *   pal             colours that change from HH.PAL (floorA, floorB, floorLine, wallR, wallL, wallCap…)
 *   accent          its door and sign colour
 *   doors           [{ wall: 'R'|'L', at, to }]   R = back-right wall (at = x), L = left wall (at = y)
 *   decos           things on the walls: { kind, wall, a0, a1, z0, z1 } (kinds in HH.DECO, gfx.js)
 *   furniture       { type, x, y, w, d, floor?, noBlock?, rot?, flip?, …whatever its drawer reads }
 *   spots           { agentId: [x, y, dx, dy] }   where someone stands and faces
 *   idle            [[x, y, dx, dy]…]             spots for whoever has none of their own, in roster order
 *   desks           { agentId: [x, y] }           the chair of someone's own desk
 *   hot             [[x, y]…]                     chairs of free desks, for anyone working here without one
 *   mine            your own office: 🏠 takes you there, the doormat calls people in
 *
 * Desks: a `workdesk` against a wall with its chair in front, facing the wall (`flip`). Back wall (R): desk
 * (x, 0) + chair (x, 1, flip). Left wall (L): desk (0, y, rot) + chair (1, y, rot, flip).
 */
(function () {
  const HH = (window.HH = window.HH || {});
  const deskL = (y, extra = {}) => [{ type: 'workdesk', x: 0, y, w: 1, d: 1, rot: 1, ...extra }, { type: 'chair', x: 1, y, w: 1, d: 1, rot: 1, flip: true, color: '#343a40' }];
  const deskR = (x, extra = {}) => [{ type: 'workdesk', x, y: 0, w: 1, d: 1, ...extra }, { type: 'chair', x, y: 1, w: 1, d: 1, flip: true, color: '#495057' }];

  HH.WORK_ROOM = 'office';             // where agents without a room of their own work
  HH.ROOM_ORDER = ['main', 'office', 'desk'];

  HH.ROOMS = {
    main: {
      id: 'main', name: 'Lobby', emoji: '🏨', accent: '#868e96',
      W: 11, H: 9, WH: 74, floor: 'tiles',
      doors: [
        { wall: 'R', at: 2, to: 'office' },
        { wall: 'L', at: 4, to: 'desk' },
      ],
      decos: [
        { kind: 'neon', wall: 'R', a0: 3.6, a1: 3.6 + HH.neonWidth('AGENT OFFICE'), z0: 56, z1: 70, text: 'AGENT OFFICE', split: 6 },
        { kind: 'clock', wall: 'L', a0: 8.5, z0: 52 },
        { kind: 'poster', wall: 'L', a0: 1.2, a1: 3.0, z0: 28, z1: 50 },
        { kind: 'window', wall: 'L', a0: 5.6, a1: 7.8, z0: 28, z1: 54 },
        { kind: 'frame', wall: 'R', a0: 4.2, a1: 4.9, z0: 30, z1: 44, color: '#ffd43b' },
        { kind: 'frame', wall: 'R', a0: 7.2, a1: 7.9, z0: 30, z1: 44, color: '#4dabf7' },
      ],
      furniture: [
        { type: 'rug', x: 3, y: 2, w: 5, d: 4, floor: true },
        { type: 'bigtable', x: 4, y: 3, w: 3, d: 2 },
        { type: 'pingpong', x: 8, y: 3, w: 2, d: 1 },
        { type: 'billar', x: 8, y: 6, w: 2, d: 1 },
        { type: 'futbolin', x: 4, y: 7, w: 2, d: 1 },
        { type: 'arcade', x: 6, y: 0, w: 1, d: 1 },
        { type: 'plant', x: 0, y: 0, w: 1, d: 1 },
        { type: 'plant', x: 10, y: 0, w: 1, d: 1 },
        { type: 'plant', x: 10, y: 8, w: 1, d: 1 },
        { type: 'lamp', x: 10, y: 2, w: 1, d: 1 },
        { type: 'sofa', x: 7, y: 8, w: 2, d: 1 },
        { type: 'armchair', x: 2, y: 8, w: 1, d: 1 },
        { type: 'side', x: 1, y: 8, w: 1, d: 1, item: 'cup' },
      ],
      idle: [[4, 2, 0, 1], [5, 2, 0, 1], [6, 2, 0, 1], [3, 4, 1, 0], [7, 3, 1, 0], [8, 5, 0, 1], [4, 6, 0, 1], [5, 6, 0, 1], [6, 1, 0, -1], [3, 3, 1, 0], [7, 4, -1, 0], [9, 5, 0, 1]],
      spawn: [7, 5],
    },

    office: {
      id: 'office', name: 'Oficina', emoji: '🛠️', accent: '#339af0',
      W: 10, H: 9, WH: 70, floor: 'grid', wallStyle: 'panels',
      pal: { floorA: '#c9ced6', floorB: '#c9ced6', floorLine: '#9aa3ae', slab: '#7d8794', slabDark: '#5f6873', wallR: '#9aa5b1', wallL: '#8a95a1', wallCap: '#c3ccd5', wallEnd: '#6d7884' },
      doors: [{ wall: 'L', at: 7, to: 'main' }],
      decos: [
        { kind: 'plans', wall: 'L', a0: 1.3, a1: 3.4, z0: 38, z1: 60 },
        { kind: 'cctv', wall: 'R', a0: 2, a1: 4.4, z0: 42, z1: 60 },
        { kind: 'aircon', wall: 'R', a0: 6.2, a1: 8.4, z0: 54, z1: 62 },
      ],
      furniture: [
        { type: 'rug', x: 6, y: 1, w: 4, d: 1, floor: true, style: 'cables' },
        // every rack is a real device on your network (devices.json, or what the ARP table sees)
        { type: 'rack', x: 6, y: 0, w: 1, d: 1 }, { type: 'rack', x: 7, y: 0, w: 1, d: 1 }, { type: 'rack', x: 8, y: 0, w: 1, d: 1 }, { type: 'rack', x: 9, y: 0, w: 1, d: 1 },
        ...deskR(2), ...deskR(3), ...deskR(4), ...deskR(5),
        ...deskL(2), ...deskL(4), ...deskL(6),
        { type: 'safe', x: 9, y: 7, w: 1, d: 1 },
        { type: 'lockers', x: 9, y: 6, w: 1, d: 1 },
        { type: 'plant', x: 8, y: 8, w: 1, d: 1 },
        { type: 'sofa', x: 4, y: 8, w: 2, d: 1 },
      ],
      hot: [[2, 1], [3, 1], [4, 1], [5, 1], [1, 2], [1, 4], [1, 6]],
      spawn: [5, 5],
    },

    desk: {
      id: 'desk', mine: true, name: 'Tu despacho', emoji: '🏠', accent: '#2f9e44',
      W: 10, H: 8, WH: 72, floor: 'carpet',
      pal: { floorA: '#4c5a73', floorB: '#45526a', floorLine: '#3c4860', slab: '#2f3a4e', slabDark: '#232c3c', wallR: '#e9ecef', wallL: '#d6dbe0', wallCap: '#f8f9fa', wallEnd: '#aab3bd' },
      doors: [{ wall: 'L', at: 4, to: 'main' }],
      decos: [
        { kind: 'window', wall: 'L', a0: 0.8, a1: 2.8, z0: 28, z1: 54 },
        { kind: 'poster', wall: 'R', a0: 8.1, a1: 9.5, z0: 26, z1: 46 },
        { kind: 'clock', wall: 'L', a0: 6.3, z0: 52 },
      ],
      furniture: [
        { type: 'rug', x: 2, y: 3, w: 5, d: 3, floor: true, style: 'plain', color: '#1864ab', color2: '#339af0' },
        { type: 'rug', x: 1, y: 4, w: 1, d: 1, floor: true, style: 'mat', action: 'call' },
        { type: 'bossdesk', x: 4, y: 1, w: 2, d: 1 },
        { type: 'chair', x: 4, y: 0, w: 1, d: 1, color: '#1a1420' },
        { type: 'bookshelf', x: 1, y: 0, w: 1, d: 1 },
        { type: 'trophies', x: 2, y: 0, w: 1, d: 1 },
        { type: 'plant', x: 9, y: 0, w: 1, d: 1 },
        { type: 'plant', x: 9, y: 7, w: 1, d: 1 },
        { type: 'sofa', x: 7, y: 7, w: 2, d: 1 },
        { type: 'side', x: 9, y: 5, w: 1, d: 1, item: 'cup' },
        { type: 'lamp', x: 7, y: 0, w: 1, d: 1 },
      ],
      idle: [[3, 3, 0, -1], [4, 3, 0, -1], [5, 3, 0, -1], [6, 3, 0, -1], [7, 3, 0, -1], [3, 5, 0, -1], [4, 5, 0, -1], [5, 5, 0, -1], [6, 5, 0, -1]],
      spawn: [1, 4],
    },
  };
})();
