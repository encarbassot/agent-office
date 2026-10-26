/* The team: one character per custom Claude Code agent (~/.claude/agents/*.md), with a pixel avatar
 * generated from its name, so the same agent always looks the same. scripts/serve.mjs puts the list in
 * HH.TEAM_RAW (/api/team.js) before this file runs; opened without the server there is no team, only dummies.
 *
 * To make an agent your own, give it an entry in team.json (next to package.json, outside git):
 *   { "my-reviewer": { "name": "Ada", "emoji": "🦉", "room": "office", "accent": "#7048e8",
 *                      "look": { "skin": "#f1c7a1", "hair": "bun", "hairColor": "#212529", "shirt": "#7048e8",
 *                                "pants": "#343a40", "extras": ["glasses"] },
 *                      "phrases": ["Let me check that."] } }
 *
 * look:
 *   skin, hairColor, shirt, pants, shoes   colours (#rrggbb)
 *   hair   short · messy · long · bun · curly · slick · ponytail · bald
 *   hat    hardhat · boina · visor · hood   (optional)
 *   extras beard · mustache · glasses · frown · smile · blush · tie · watch · heart · scarf · hoodie · cardigan ·
 *          headset · apron · blueprint · clapper · calc · cables · pen · egg · cane
 */
(function () {
  const HH = (window.HH = window.HH || {});

  HH.PLAYER = {
    id: 'you', emoji: '🎮', name: 'Tú', role: 'Tú (el jugador)',
    look: { skin: '#eec39a', hair: 'messy', hairColor: '#3b2a20', shirt: '#2b2f36', pants: '#3d5a80', shoes: '#f1f3f5', extras: ['hoodie'] },
    stepMs: 380,
  };

  const SKINS = ['#f1c7a1', '#eec39a', '#d9a47a', '#c68642', '#a0663f', '#8d5524', '#f5d6c6'];
  const HAIRS = ['short', 'messy', 'long', 'bun', 'curly', 'slick', 'ponytail', 'bald'];
  const HAIR_C = ['#2b2b2b', '#3b2a20', '#6b4423', '#a0522d', '#d9b65a', '#c92a2a', '#868e96', '#f8f9fa'];
  const PANTS = ['#343a40', '#3d5a80', '#495057', '#5c4433', '#2b2f36', '#1864ab'];
  const EXTRAS = [[], ['glasses'], ['beard'], ['smile'], ['headset'], ['scarf'], ['tie'], ['mustache', 'smile'], ['cardigan'], ['pen']];
  const EMOJI = ['🦊', '🐙', '🦉', '🐝', '🐢', '🦄', '🐧', '🦁', '🐸', '🐼', '🦜', '🐳'];
  const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const at = (arr, h, k) => arr[(h >>> k) % arr.length];
  const hsl = (h, s, l) => { // → #rrggbb
    const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  };
  const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const pretty = (id) => id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  HH.MAESTROS = (HH.TEAM_RAW || []).map((t) => {
    const h = hash(t.id), o = t.custom || {}, accent = o.accent || hsl(h % 360, 0.62, 0.55);
    return {
      id: t.id, agent: t.id, name: o.name || pretty(t.id), emoji: o.emoji || at(EMOJI, h, 3),
      role: o.role || clip(t.description, 60) || 'Agente', personality: clip(t.description, 300), lleva: o.lleva || '', folder: '',
      accent, stepMs: o.stepMs || 380, lang: o.lang || 'es-ES', room: o.room || null,
      look: o.look || { skin: at(SKINS, h, 1), hair: at(HAIRS, h, 5), hairColor: at(HAIR_C, h, 9), shirt: accent, pants: at(PANTS, h, 13), extras: at(EXTRAS, h, 17) },
      phrases: o.phrases && o.phrases.length ? o.phrases : [clip(t.description, 80) || '…'], activities: [],
    };
  });
  HH.DEPT = Object.fromEntries(HH.MAESTROS.filter((m) => m.room).map((m) => [m.id, m.room])); // who works in which room
  HH.byId = (id) => HH.MAESTROS.find((m) => m.id === id);
})();
