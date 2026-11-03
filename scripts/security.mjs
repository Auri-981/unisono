/**
 * Prueba de seguridad contra TU proyecto real de Supabase: un «atacante» intenta leer y cambiar
 * los datos de otro jugador.
 *
 * Crea una víctima con datos (perfil, sala con chat, vale de cuenta) y comprueba que:
 *   - sin sesión no se puede leer ninguna tabla,
 *   - con sesión cada uno solo lee lo suyo (salvo los catálogos de la tienda y los logros),
 *   - nadie puede escribir en las tablas (ni en lo suyo: monedas y cartas solo cambian en el servidor),
 *   - las cuentas y los correos (esquema `auth`) y la lógica interna (`game_private`) no son accesibles,
 *   - no se pueden ver salas ni perfiles ajenos, ni por GraphQL.
 * Las tablas se leen de la migración: una tabla nueva queda comprobada sin tocar este archivo.
 *
 * Uso: npm run security   (lee VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY de `.env.local`).
 * Crea 2 usuarios anónimos y los borra al terminar.
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

const MIGRATION = 'supabase/migrations/20261019000000_unisono.sql';
const TABLES = [...readFileSync(MIGRATION, 'utf8').matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
/** Catálogos que todos pueden leer (no tienen datos de jugadores). */
const CATALOG = ['cosmetics', 'achievements', 'achievement_cosmetics'];

const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function player() {
  const sb = client();
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw new Error(`No se pudo crear la sesión anónima (${error.message}).`);
  return { sb, id: data.user.id };
}

async function main() {
  console.log(`Tablas comprobadas (${TABLES.length}): ${TABLES.join(', ')}\n`);

  // Una víctima con datos.
  const victim = await player();
  await victim.sb.rpc('get_my_profile');
  const { data: room, error: roomErr } = await victim.sb.rpc('create_room', { p_name: 'Víctima', p_config: { chat: true } });
  if (roomErr) throw new Error(`No se pudo crear la sala (${roomErr.message}).`);
  await victim.sb.rpc('send_chat', { p_room: room.room.id, p_body: 'mensaje privado' });
  await victim.sb.rpc('start_account_merge');

  // Sin sesión: solo con la clave pública de la web.
  const nobody = client();
  for (const t of TABLES) {
    const { data, error } = await nobody.from(t).select('*').limit(5);
    ok(Boolean(error) || data.length === 0, `sin sesión: ${t} → ${error ? 'bloqueado' : `${data.length} filas`}`);
  }

  // Con sesión: cualquiera puede tener una abriendo la web.
  const attacker = await player();
  await attacker.sb.rpc('get_my_profile');
  for (const t of TABLES) {
    const { data, error } = await attacker.sb.from(t).select('*').limit(1000);
    if (error) {
      ok(true, `atacante lee ${t} → bloqueado`);
    } else if (CATALOG.includes(t)) {
      ok(true, `atacante lee ${t} → catálogo público (${data.length} filas)`);
    } else {
      const foreign = data.filter((r) => JSON.stringify(r).includes(victim.id) || (r.user_id && r.user_id !== attacker.id));
      ok(foreign.length === 0, `atacante lee ${t} → ${data.length} filas, ajenas: ${foreign.length}`);
    }
  }

  // Escrituras: sobre lo de la víctima y sobre lo propio.
  const writes = [
    ['quitar monedas a la víctima', () => attacker.sb.from('player_wallets').update({ coins: 0 }).eq('user_id', victim.id).select()],
    ['darse monedas', () => attacker.sb.from('player_wallets').update({ coins: 99999 }).eq('user_id', attacker.id).select()],
    ['regalarse una carta exclusiva', () => attacker.sb.from('player_cosmetics').insert({ user_id: attacker.id, cosmetic_id: 'phoenix', source: 'achievement' }).select()],
    ['regalarse un logro', () => attacker.sb.from('player_achievements').insert({ user_id: attacker.id, achievement_id: 'wins_50' }).select()],
    ['borrar una sala ajena', () => attacker.sb.from('rooms').delete().eq('id', room.room.id).select()],
    ['escribir en el chat como otro', () => attacker.sb.from('chat_messages').insert({ room_id: room.room.id, user_id: victim.id, name: 'X', body: 'falso' }).select()],
    ['borrar vales de cuenta', () => attacker.sb.from('account_merges').delete().neq('token', '').select()],
  ];
  for (const [name, run] of writes) {
    const { data, error } = await run();
    ok(Boolean(error) || (data ?? []).length === 0, `${name} → ${error ? 'bloqueado' : `${(data ?? []).length} filas cambiadas`}`);
  }
  const { data: vp } = await victim.sb.rpc('get_my_profile');
  ok(vp.coins === 0 && vp.owned.length === 1, 'los datos de la víctima siguen intactos');
  const { data: ap } = await attacker.sb.rpc('get_my_profile');
  ok(ap.coins === 0 && !ap.owned.includes('phoenix') && !ap.achievements.find((a) => a.id === 'wins_50').unlockedAt, 'el atacante no se ha dado nada');

  // Cuentas, correos y lógica interna.
  for (const schema of ['auth', 'game_private']) {
    const { data, error } = await attacker.sb.schema(schema).from('users').select('*').limit(5);
    ok(Boolean(error) && !data, `esquema ${schema} desde la API → ${error ? 'bloqueado' : 'ACCESIBLE'}`);
  }
  const { error: profileErr } = await attacker.sb.rpc('profile', { p_uid: victim.id });
  ok(Boolean(profileErr), 'no se puede pedir el perfil de otro jugador');
  const { data: state, error: stateErr } = await attacker.sb.rpc('get_room_state', { p_room: room.room.id });
  ok(Boolean(stateErr) || state?.error === 'NOT_MEMBER', `sala ajena → ${stateErr?.message ?? state?.error}`);

  // GraphQL: la otra puerta de entrada de Supabase.
  const { data: sess } = await attacker.sb.auth.getSession();
  const gql = await fetch(`${URL_}/graphql/v1`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${sess.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __schema { queryType { fields { name } } } }' }),
  });
  const fields = (await gql.json().catch(() => null))?.data?.__schema?.queryType?.fields?.map((f) => f.name) ?? [];
  ok(!fields.some((f) => /user|auth|email/i.test(f)), `GraphQL no da acceso a cuentas ni correos (consultas: ${fields.join(', ') || 'ninguna'})`);

  // Limpieza: se borran los dos usuarios de prueba.
  await victim.sb.rpc('leave_room', { p_room: room.room.id });
  for (const p of [victim, attacker]) {
    const { data } = await p.sb.rpc('delete_my_account');
    ok(data?.deleted === true, 'usuario de prueba borrado');
  }

  console.log(failures ? `\n${failures} comprobación(es) fallida(s).` : '\nTodo correcto: nadie puede leer ni cambiar datos ajenos.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n✘ Error: ${e.message}`);
  process.exit(1);
});
