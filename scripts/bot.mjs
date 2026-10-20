// Simula el móvil de un amigo que se une a tu sala y juega solo (para probar sin compañía).
// Uso: npm run bot -- CODIGO [segundos]   (necesita .env.local)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split(/\r?\n/).map((l) => l.split('=')));
const code = process.argv[2];
const seconds = Number(process.argv[3] ?? 120);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
await sb.auth.signInAnonymously();
const rpc = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};
let snap = await rpc('join_room', { p_code: code, p_name: 'Beto (bot)' });
console.log('joined', snap.room.code, 'players', snap.players.map((p) => p.name).join(', '));
await rpc('set_lobby_ready', { p_room: snap.room.id, p_ready: true });
const room = snap.room.id;
const end = Date.now() + seconds * 1000;
let planned = null;
while (Date.now() < end) {
  try {
    snap = await rpc('get_room_state', { p_room: room });
  } catch (e) {
    console.log('state error', e.message);
    break;
  }
  const r = snap.room;
  if (r.status === 'playing' && snap.vote && !snap.vote.votes.includes(snap.me)) {
    await rpc('vote_shuriken', { p_room: room, p_accept: true }).catch((e) => console.log('vote', e.message));
    console.log('voted shuriken');
  } else if (r.status === 'playing' && !snap.vote && snap.myHand.length) {
    const card = snap.myHand[0];
    const top = snap.pile.at(-1)?.c ?? 0;
    const key = `${r.level}:${card}:${snap.pile.length}`;
    if (planned?.key !== key) planned = { key, at: Date.now() + 800 + Math.max(0, card - top) * 120 };
    if (Date.now() >= planned.at) {
      await rpc('play_card', { p_room: room, p_card: card, p_action: crypto.randomUUID() })
        .then((s) => console.log('played', card, '→ lives', s.room.lives, 'status', s.room.status))
        .catch((e) => console.log('play', card, e.message));
    }
  } else if (r.status === 'level_complete' && !snap.players.find((p) => p.id === snap.me)?.ready) {
    await rpc('ready_next_level', { p_room: room, p_level: r.level, p_force: false });
    console.log('ready after level', r.level);
  } else if (['won', 'lost', 'abandoned'].includes(r.status)) {
    console.log('game over', r.status);
  }
  await new Promise((res) => setTimeout(res, 300));
}
console.log('bot done');
process.exit(0);
