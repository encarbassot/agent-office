#!/usr/bin/env node
/* Agent Office · the local server. Serves the room and tells it what your Claude Code agents are doing,
 * reading ~/.claude. It never writes there, never talks to an agent and never sends anything anywhere.
 *
 *   node scripts/serve.mjs [--port 5188] [--company <folder>] [--lan]
 *
 *   --company <folder>  only count agents working under that folder (a «company»). Default: all of them.
 *   --lan               open the room to your network (phone, tablet…), with a key: the first time you come in
 *                       with the link printed in the terminal (…/?k=<key>), which leaves a cookie. Without
 *                       --lan it only listens on 127.0.0.1. The key lives in .office-key (outside git).
 *                       Other devices only learn who is working, never on what.
 *
 *   GET /api/team.js   your custom agents (~/.claude/agents/*.md) as the team, plus team.json overrides
 *   GET /api/agents    { agents: [{ key, kind, maestro, label, working, task, doing, at }] }
 *                      live sessions (~/.claude/sessions/<pid>.json), subagents of each session
 *                      (projects/<project>/<session>/subagents/*.meta.json) and the last meaningful line of
 *                      each transcript (a tool call, a thought or what it wrote, clipped)
 *   GET /api/devices   { devices: [{ name, host, role, up, ms, source }] }  a real ping to each device:
 *                      the list in devices.json, plus whatever the ARP table has seen
 *
 * These ~/.claude files are Claude Code internals (tested with 2.1.x): if their shape changes, fix it here.
 * No dependencies.
 */
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.resolve(here, '..');
const arg = (k, def) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : def; };
const port = Number(arg('--port', process.env.PORT || 5188));
const lan = process.argv.includes('--lan');
const claude = path.join(os.homedir(), '.claude');
const company = arg('--company', null) && path.resolve(arg('--company'));

// ---------- the key for other devices (only with --lan) ----------
const keyFile = path.join(proj, '.office-key');
let key = null;
if (lan) {
  try { key = fs.readFileSync(keyFile, 'utf8').trim(); } catch { /* first time */ }
  if (!/^[a-f0-9]{32}$/.test(key || '')) { key = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(keyFile, key + '\n', { mode: 0o600 }); }
}
const lanIps = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
const sameKey = (k) => !!k && !!key && k.length === key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(key));
const cookieKey = (req) => ((req.headers.cookie || '').match(/(?:^|;\s*)office_k=([a-f0-9]{32})/) || [])[1];
const isLoopback = (req) => /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '');

const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const clip = (t, n = 150) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// ---------- the team: your custom agents ----------
function team() {
  const dir = path.join(claude, 'agents'), custom = readJSON(path.join(proj, 'team.json')) || {}, out = [];
  let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { /* no custom agents */ }
  for (const f of files) {
    let src; try { src = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const fm = (src.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const id = ((fm.match(/^name:\s*(.+)$/m) || [])[1] || f.slice(0, -3)).trim().replace(/^["']|["']$/g, '');
    const description = ((fm.match(/^description:\s*(.+)$/m) || [])[1] || '').replace(/^["']|["']$/g, '');
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(id)) out.push({ id, description: clip(description, 300), custom: custom[id] || null });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- agents: what Claude Code is doing ----------
const encDir = (p) => p.replace(/[^a-zA-Z0-9]/g, '-'); // how Claude Code names its project folders
const inCompany = (dirName) => { if (!company) return true; const c = encDir(company); return dirName === c || dirName.startsWith(c + '-'); };
function toolLine(name, inp = {}) {
  const base = (p) => String(p).split('/').slice(-2).join('/');
  const what = inp.description || (inp.file_path && base(inp.file_path)) || inp.pattern || inp.query || inp.url || String(inp.command || inp.prompt || '').split('\n')[0];
  return clip(`${String(name).split('__').pop()}${what ? ': ' + what : ''}`, 110); // mcp__server__tool → tool
}
// the last thing an agent did, from the tail of its transcript
function lastActivity(file) {
  let fd, buf;
  try {
    const st = fs.statSync(file), len = Math.min(st.size, 160 * 1024);
    fd = fs.openSync(file, 'r'); buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len);
  } catch { return null; } finally { if (fd) fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i > 0; i--) { // (line 0 may be cut in half)
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
    for (let j = o.message.content.length - 1; j >= 0; j--) {
      const c = o.message.content[j];
      if (c.type === 'tool_use' && !/Handback|StructuredOutput/.test(c.name)) return { doing: toolLine(c.name, c.input), at: o.timestamp };
      if (c.type === 'thinking' && c.thinking) return { doing: '💭 ' + clip(c.thinking), at: o.timestamp };
      if (c.type === 'text' && c.text && c.text.trim()) return { doing: clip(c.text), at: o.timestamp };
    }
  }
  return null;
}
let agCache = { at: 0, data: null };
function agents() {
  if (agCache.data && Date.now() - agCache.at < 3000) return agCache.data;
  const mine = new Set(team().map((t) => t.id)), out = [], FRESH = 15 * 60e3, WEEK = 7 * 864e5;
  const live = {}; // running Claude Code sessions: sessionId → { status, name, cwd }
  try {
    for (const f of fs.readdirSync(path.join(claude, 'sessions'))) {
      if (!/^\d+\.json$/.test(f)) continue;
      const s = readJSON(path.join(claude, 'sessions', f));
      if (s && s.sessionId && alive(s.pid)) live[s.sessionId] = s;
    }
  } catch { /* no sessions dir */ }
  let projects = [];
  try { projects = fs.readdirSync(path.join(claude, 'projects')).filter(inCompany); } catch { /* none */ }
  for (const p of projects) {
    const pd = path.join(claude, 'projects', p);
    let entries = []; try { entries = fs.readdirSync(pd, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) { // a top-level session working right now = a dummy at a desk
        const sid = e.name.slice(0, -6), s = live[sid];
        if (s && s.status === 'busy') {
          const act = lastActivity(path.join(pd, e.name)) || {};
          out.push({ key: 's-' + sid.slice(0, 8), kind: 'session', maestro: null, label: s.name || 'Session', working: true, task: s.name || '', doing: act.doing || '', at: act.at || null });
        }
        continue;
      }
      if (!e.isDirectory()) continue;
      const sd = path.join(pd, e.name, 'subagents');
      let files = []; try { files = fs.readdirSync(sd).filter((f) => f.endsWith('.meta.json')); } catch { continue; }
      for (const m of files) {
        const jf = path.join(sd, m.replace('.meta.json', '.jsonl'));
        let st; try { st = fs.statSync(jf); } catch { continue; }
        if (Date.now() - st.mtimeMs > WEEK) continue;
        const meta = readJSON(path.join(sd, m)) || {};
        const working = !meta.finished && Date.now() - st.mtimeMs < FRESH && !!live[e.name];
        const maestro = mine.has(meta.agentType) ? meta.agentType : null;
        if (!working && !maestro) continue; // finished nameless agents don't matter
        const act = lastActivity(jf) || {};
        out.push({ key: 'a-' + m.slice(6, 14), kind: maestro ? 'maestro' : 'dummy', maestro, label: meta.agentType || 'agent', working, task: meta.description || '', doing: act.doing || '', at: act.at || st.mtime.toISOString(), mtime: st.mtimeMs });
      }
    }
  }
  const best = {}; // per character keep the one that matters: working first, else the latest
  for (const a of out.filter((x) => x.maestro)) { const b = best[a.maestro]; if (!b || (a.working && !b.working) || (a.working === b.working && a.mtime > b.mtime)) best[a.maestro] = a; }
  const data = [...out.filter((x) => !x.maestro), ...Object.values(best)].map(({ mtime, ...a }) => a);
  agCache = { at: Date.now(), data };
  return data;
}

// ---------- devices: a real ping to each one ----------
const okHost = (h) => /^[a-zA-Z0-9.:-]{1,253}$/.test(h);
const run = (cmd, args, ms) => new Promise((res) => execFile(cmd, args, { timeout: ms }, (err, out) => res(err ? { err, out: String(out || '') } : { out: String(out) })));
async function ping(host) { const first = await ping1(host); return first.up ? first : ping1(host); } // one retry: Wi-Fi drops packets
async function ping1(host) {
  const args = process.platform === 'darwin' ? ['-c', '1', '-t', '1', host] : ['-c', '1', '-W', '1', host];
  const { err, out } = await run('ping', args, 2500);
  const ms = (out.match(/time[=<]([\d.]+)\s*ms/) || [])[1];
  return { up: !err && !!ms, ms: ms ? Math.round(Number(ms)) : null };
}
async function arpDevices() {
  const { out } = await run('arp', ['-a'], 2500), list = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\S+) \(([\d.]+)\) at ([0-9a-f:]+)/i);
    if (!m || /^(224|239|255)\./.test(m[2]) || m[2].endsWith('.255') || /^ff:ff/i.test(m[3])) continue;
    list.push({ name: m[1] === '?' ? m[2] : m[1].split('.')[0], host: m[2], source: 'network' });
  }
  return list;
}
let devCache = { at: 0, data: null };
async function devices() {
  if (devCache.data && Date.now() - devCache.at < 8000) return devCache.data;
  let mine = [];
  try { mine = ((readJSON(path.join(proj, 'devices.json')) || {}).devices || []).filter((d) => d && okHost(String(d.host))).map((d) => ({ name: String(d.name || d.host), host: String(d.host), role: d.role ? String(d.role) : '', source: 'list' })); } catch { /* no list */ }
  const seen = new Set(mine.map((d) => d.host));
  const all = [...mine, ...(await arpDevices()).filter((d) => !seen.has(d.host))].slice(0, 32);
  devCache = { at: Date.now(), data: await Promise.all(all.map(async (d) => ({ ...d, ...(await ping(d.host)) }))) };
  return devCache.data;
}

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };
const host0 = os.hostname().replace(/\.local$/, '');
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(lan ? [...lanIps.map((ip) => `${ip}:${port}`), `${host0}.local:${port}`, `${host0}:${port}`] : [])]);
const realProj = fs.realpathSync(proj);
const send = (res, code, body, type = 'text/plain; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(body); };

http.createServer((req, res) => {
  if (!allowedHosts.has(req.headers.host || '')) return send(res, 403, 'forbidden host'); // DNS rebinding
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  let url;
  try { url = new URL(req.url, `http://${req.headers.host}`); } catch { return send(res, 400, 'bad url'); }
  const p = url.pathname, local = isLoopback(req);

  if (!local && !sameKey(cookieKey(req))) { // another device: the key (first in the link, then a cookie), or nothing
    if (sameKey(url.searchParams.get('k') || '')) {
      url.searchParams.delete('k');
      res.writeHead(302, { Location: url.pathname + (url.search || ''), 'Set-Cookie': `office_k=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
      return res.end();
    }
    return send(res, 401, '🔒 Open the link with the key printed in the terminal (npm run dev -- --lan).');
  }

  const noStore = { 'Cache-Control': 'no-store' };
  if (p === '/api/team.js') {
    const t = team().map((x) => (local ? x : { id: x.id, description: '', custom: x.custom }));
    return send(res, 200, `window.HH = window.HH || {}; window.HH.TEAM_RAW = ${JSON.stringify(t)};`, TYPES['.js'], noStore);
  }
  if (p === '/api/agents') { // other devices: who works, never on what
    const list = agents().map((a) => (local ? a : { key: a.key, kind: a.kind, maestro: a.maestro, label: a.maestro ? a.label : 'Agent', working: a.working }));
    return send(res, 200, JSON.stringify({ agents: list }), 'application/json', noStore);
  }
  if (p === '/api/todo') return send(res, 200, JSON.stringify({ ids: [] }), 'application/json', noStore); // notebooks: not in this build
  if (p === '/api/devices') { devices().then((d) => send(res, 200, JSON.stringify({ devices: d }), 'application/json', noStore)).catch(() => send(res, 500, 'devices failed')); return; }

  // static files of the office itself: nothing outside it, nothing hidden, no private config
  let rel;
  try { rel = decodeURIComponent(p); } catch { return send(res, 400, 'bad path'); }
  if (rel.includes('\0') || rel.split('/').some((seg) => seg.startsWith('.')) || /^\/(devices|team)(\.example)?\.json$/.test(rel)) return send(res, 404, 'not found');
  let file = path.resolve(proj, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  try {
    file = fs.realpathSync(file);
    if (file !== realProj && !file.startsWith(realProj + path.sep)) return send(res, 404, 'not found');
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    return send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch { return send(res, 404, 'not found'); }
}).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`🏢 Agent Office → http://localhost:${port}`);
  if (lan) for (const ip of lanIps) console.log(`📱 from another device on your network → http://${ip}:${port}/?k=${key}`);
  console.log(`👥 team: ${team().map((t) => t.id).join(', ') || 'none (only dummies) · add agents in ~/.claude/agents'}`);
});
