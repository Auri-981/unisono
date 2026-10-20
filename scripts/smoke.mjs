/**
 * Prueba de extremo a extremo contra TU proyecto real de Supabase.
 *
 * Simula 3 móviles (3 sesiones anónimas distintas) que crean una sala, se unen,
 * juegan una partida entera y comprueban:
 *   - que el tiempo real avisa a los demás jugadores,
 *   - que nadie puede leer las cartas de otro (ni consultando la tabla a mano),
 *   - que no se puede escribir directamente en las tablas,
 *   - que la partida termina en victoria jugando en orden.
 *
 * Uso (PowerShell o bash), con las mismas variables que la web:
 *   npm run smoke
 * Lee VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY de `.env.local` o del entorno.
 * Crea 3 usuarios anónimos (cuentan para el límite de 30/hora por IP).
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_ || !KEY) {
  console.error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY (en .env.local o en el entorno).');
  process.exit(1);
}

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function player(name) {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw new Error(`No se pudo crear la sesión anónima (${error.message}). ¿Activaste "Anonymous sign-ins"?`);
  const rpc = async (fn, args) => {
    const { data: d, error: e } = await sb.rpc(fn, args);
    if (e) throw new Error(e.message);
    return d;
  };
  return { sb, id: data.user.id, name, rpc };
}

async function main() {
  console.log(`Probando ${URL_} …\n`);
  const [a, b, c] = await Promise.all([player('Ana'), player('Beto'), player('Carla')]);
  ok(new Set([a.id, b.id, c.id]).size === 3, 'tres sesiones anónimas distintas');

  const created = await a.rpc('create_room', { p_name: 'Ana', p_config: {} });
  const room = created.room.id;
  ok(/^[A-Z0-9]{5}$/.test(created.room.code), `sala creada con código ${created.room.code}`);

  // Beto escucha la sala en tiempo real (como la app: tabla room_signals).
  const signals = [];
  const channel = b.sb
    .channel(`smoke:${room}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_signals', filter: `room_id=eq.${room}` }, (p) => {
      signals.push(Number(p.new?.version));
    });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El canal de tiempo real no se conectó en 15 s')), 15000);
    // Beto aún no es miembro: se une primero y luego se suscribe. Se espera a que el servidor
    // confirme la escucha de cambios ("Subscribed to PostgreSQL"), que llega tras SUBSCRIBED.
    channel.on('system', {}, (msg) => {
      if (msg.extension === 'postgres_changes' && msg.status === 'ok') {
        clearTimeout(timer);
        resolve();
      } else if (msg.status === 'error') {
        clearTimeout(timer);
        reject(new Error(`Tiempo real: ${msg.message}`));
      }
    });
    b.rpc('join_room', { p_code: created.room.code, p_name: 'Beto' })
      .then(() => channel.subscribe())
      .catch(reject);
  });
  ok(true, 'Beto se une y se suscribe al tiempo real');

  const missing = await c.rpc('join_room', { p_code: 'ZZZZZ', p_name: 'Carla' });
  ok(missing?.error === 'ROOM_NOT_FOUND', 'código inexistente → ROOM_NOT_FOUND');
  const joined = await c.rpc('join_room', { p_code: created.room.code, p_name: 'Carla' });

  let readyVersion = 0;
  for (const p of [a, b, c]) readyVersion = (await p.rpc('set_lobby_ready', { p_room: room, p_ready: true })).room.version;
  const started = await a.rpc('start_game', { p_room: room });
  for (let i = 0; i < 20 && !signals.includes(started.room.version); i++) await sleep(250);
  await sleep(1000); // margen por si llegara alguna señal duplicada
  const got = signals.filter((v) => v > Math.max(joined.room.version, readyVersion));
  ok(got.includes(started.room.version), `Beto recibe el aviso en tiempo real (versión ${started.room.version})`);
  ok(got.length === 1, `una sola señal por acción (recibidas: ${got.length})`);

  // Privacidad: cada uno solo ve su fila de cartas.
  for (const p of [a, b, c]) {
    const { data, error } = await p.sb.from('hands').select('user_id, card');
    ok(!error && data.length === 1 && data.every((r) => r.user_id === p.id), `${p.name} solo puede leer su propia carta`);
  }
  const { data: spy } = await a.sb.from('hands').select('card').eq('user_id', b.id);
  ok(Array.isArray(spy) && spy.length === 0, 'Ana no puede leer las cartas de Beto aunque filtre por su id');

  // Escritura directa prohibida.
  const { error: upErr } = await a.sb.from('rooms').update({ lives: 99 }).eq('id', room);
  const { data: livesRow } = await a.sb.from('rooms').select('lives').eq('id', room).single();
  ok(Boolean(upErr) || livesRow.lives !== 99, 'no se pueden modificar las vidas desde el cliente');
  const { error: insErr } = await a.sb.from('hands').insert({ room_id: room, user_id: a.id, card: 1 });
  ok(Boolean(insErr), 'no se pueden insertar cartas desde el cliente');
  const { error: privErr } = await a.sb.schema('game_private').rpc('deal', { p_room: room });
  ok(Boolean(privErr), 'las funciones internas no son accesibles');

  // Partida completa: en cada nivel, se juegan las cartas en el orden correcto.
  const players = [a, b, c];
  for (let guard = 0; guard < 20; guard++) {
    const state = await a.rpc('get_room_state', { p_room: room });
    if (state.room.status === 'won' || state.room.status === 'lost') break;
    if (state.room.status === 'level_complete') {
      for (const p of players) await p.rpc('ready_next_level', { p_room: room, p_level: state.room.level, p_force: false });
      continue;
    }
    const hands = await Promise.all(players.map((p) => p.rpc('get_room_state', { p_room: room })));
    const all = hands.flatMap((h, i) => h.myHand.map((card) => ({ card, p: players[i] }))).sort((x, y) => x.card - y.card);
    for (const { card, p } of all) await p.rpc('play_card', { p_room: room, p_card: card, p_action: crypto.randomUUID() });
  }
  const final = await b.rpc('get_room_state', { p_room: room });
  ok(final.room.status === 'won', `partida terminada en victoria (nivel ${final.room.level}/${final.room.maxLevel}, ${final.room.lives} vidas)`);

  for (const p of players) await p.rpc('leave_room', { p_room: room }).catch(() => {});
  await b.sb.removeChannel(channel);
  for (const p of players) await p.sb.auth.signOut().catch(() => {});

  console.log(failures ? `\n${failures} comprobación(es) fallida(s).` : '\nTodo correcto: el servidor está listo para jugar.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n✘ Error: ${e.message}`);
  process.exit(1);
});
