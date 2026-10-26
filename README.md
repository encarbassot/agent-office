# 🏢 Agent Office

A pixel-art office for your **Claude Code** agents. When an agent is working, its character walks in from the
lobby, sits at its desk with its back to you and types, with its screen lit up with code. When it's done, it goes
back to the lobby to play ping-pong. Hover over anyone to see what they are on right now.

- **Your agents become characters.** Every custom agent in `~/.claude/agents/*.md` gets its own pixel avatar,
  generated from its name, so it always looks the same. Built-in agents (`Explore`, `general-purpose`…) and busy
  Claude Code sessions show up as **crash-test dummies** 🟨, only while they work.
- **Hover = what they're doing.** The task they were given and their last action: the tool they called, a thought,
  or the last line they wrote, plus how long ago.
- **All the rooms at once.** The room you're in is big; the others are live miniatures underneath. Tap one to go there.
- **Read-only, local.** The server only *reads* `~/.claude`. It never writes there, never talks to an agent and
  never sends anything anywhere. It listens on `127.0.0.1`.
- **A real network rack.** In the office, each server rack is a device on your network, pinged for real: green it
  answers, red it doesn't.
- **A little Habbo-style toy.** Walk around (double-tap to teleport), drag people by the head like Wii Miis, sit
  on chairs, ✏️ edit any room, 🎒 a free inventory of ~65 pieces of furniture, rotate them, zoom and pan on a phone.

All the pixel art is drawn by code. No Habbo (Sulake) assets inside.

## Run it

```bash
npm run dev            # http://localhost:5188 · node ≥ 18, no dependencies, nothing to install
```

Options (`npm run dev -- …`):

| Flag | What |
|---|---|
| `--port 5199` | another port |
| `--company ~/code/acme` | only agents working under that folder (one office per company) |
| `--lan` | open it to your Wi-Fi (phone, tablet) with a key: open the link printed in the terminal once and a cookie remembers it. Other devices only learn **who** is working, never on what |

Opening `index.html` without the server works too, as a toy: no agents, no network.

## Make it yours

- **Characters:** copy `team.example.json` to `team.json` and give any agent a name, emoji, look, room and
  phrases (it stays out of git). The look options are in `src/team.js`.
- **Rooms:** `src/rooms.js` is an example office (lobby, office, your desk). Edit it, or rearrange furniture in
  the browser with ✏️ Edit (saved in the browser). A room with `hot` chairs is where agents without a room of
  their own sit. Its format is documented at the top of the file.
- **Devices:** copy `devices.example.json` to `devices.json` (outside git). Without it, the racks show what your
  ARP table has seen.
- **Try it without agents:** in the browser console,
  `HH.debug.fakeAgents.push({ label: 'Explore', working: true, task: 'Find the bug', doing: 'Grep: TODO' })`.

## How it knows

`scripts/serve.mjs` reads three things from `~/.claude`:

1. `sessions/<pid>.json`: the running Claude Code sessions and whether they are `busy`.
2. `projects/<project>/<session>/subagents/agent-*.meta.json`: each subagent's type, task (`description`) and
   whether it `finished`.
3. The tail of each transcript (`*.jsonl`), for the last meaningful line.

These are Claude Code internals, not a public API (tested with 2.1.x). If their shape changes, the fix goes in
`serve.mjs`. Heads-up: the "last line" can contain anything an agent typed (a command, a file path…), and it
is painted on screen. Mind that before you record a video or share a screenshot.

## Files

| File | What |
|---|---|
| `index.html` | the page, styles, sheets |
| `src/gfx.js` | isometric projection, crisp pixel raster, floors, walls, doors, furniture, avatars, shared leg poses |
| `src/team.js` | the player and the team, avatars generated from agent names |
| `src/rooms.js` | the rooms (example office) |
| `src/catalog.js` | the inventory: every piece of furniture and wall item |
| `src/main.js` | loop, rooms, A*, input, drag & drop, edit mode, inventory, agents, miniatures, overlay |
| `scripts/serve.mjs` | the local server: static files, `/api/team.js`, `/api/agents`, `/api/devices` |

The UI is in Spanish for now.

## License

MIT · © 2026 Eloi Wenceslao Fàbrega Grech
