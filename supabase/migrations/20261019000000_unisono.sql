-- ============================================================================
-- Unísono · esquema completo del servidor (Supabase / Postgres 15+)
--
-- Cómo aplicarlo: Panel de Supabase → SQL Editor → pega TODO este archivo → Run.
-- Se puede ejecutar más de una vez sin romper nada.
--
-- Principios:
--   * Los clientes NO pueden escribir en ninguna tabla. Solo llaman funciones `public.*`
--     que validan quién llama (auth.uid()), si pertenece a la sala y si la acción es legal.
--   * Cada función que modifica una sala bloquea su fila (SELECT … FOR UPDATE):
--     las acciones de una sala se aplican de una en una, en un orden inequívoco.
--   * Las cartas (tabla `hands`) solo las puede leer su dueño y NO se emiten por Realtime.
--   * La lógica interna vive en el esquema `game_private`, que la API no expone.
--   * Las reglas son un espejo de src/game/engine.ts y src/config/gameConfig.ts
--     (comprobado por tests/integration/conformance.test.ts).
-- ============================================================================

create schema if not exists game_private;
revoke all on schema game_private from public;

-- ───────────────────────────── Tablas ─────────────────────────────

create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9]{5}$'),
  host_id       uuid not null,
  created_by    uuid not null,
  status        text not null default 'lobby'
                check (status in ('lobby', 'playing', 'level_complete', 'won', 'lost', 'abandoned')),
  config        jsonb not null,
  game_no       int not null default 0,
  level         int not null default 0,
  max_level     int not null default 0,
  lives         int not null default 0,
  shurikens     int not null default 0,
  lives_cap     int not null default 0,
  shurikens_cap int not null default 0,
  pile          jsonb not null default '[]'::jsonb,   -- [{c, p}] cartas jugadas en el nivel
  revealed      jsonb not null default '[]'::jsonb,   -- [{c, p, r}] descartes visibles
  vote          jsonb,                                -- {proposer, votes[], expiresAt}
  last_event    jsonb,
  last_reward   jsonb,
  event_seq     int not null default 0,
  version       bigint not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rooms_created_by_idx on public.rooms (created_by, created_at);
create index if not exists rooms_updated_at_idx on public.rooms (updated_at);

create table if not exists public.room_players (
  room_id      uuid not null references public.rooms (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 20),
  seat         int not null,
  ready        boolean not null default false,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_players_user_idx on public.room_players (user_id);

-- Una fila por carta. La clave (room_id, card) impide que una carta esté en dos manos.
create table if not exists public.hands (
  room_id uuid not null,
  user_id uuid not null,
  card    smallint not null check (card between 1 and 100),
  primary key (room_id, card),
  foreign key (room_id, user_id) references public.room_players (room_id, user_id) on delete cascade
);
create index if not exists hands_owner_idx on public.hands (room_id, user_id, card);

create table if not exists public.room_events (
  room_id    uuid not null references public.rooms (id) on delete cascade,
  seq        int not null,
  game_no    int not null,
  kind       text not null,
  actor      uuid,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (room_id, seq)
);

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null,
  name       text not null,
  body       text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists chat_room_idx on public.chat_messages (room_id, id);

-- Acciones ya procesadas (para ignorar reintentos de red).
create table if not exists public.processed_actions (
  user_id    uuid not null,
  action_id  uuid not null,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, action_id)
);

-- Intentos fallidos de unirse (frena la búsqueda de códigos por fuerza bruta).
create table if not exists public.join_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on public.join_attempts (user_id, created_at);

-- Historial de partidas terminadas (sobrevive al borrado de la sala).
create table if not exists public.game_results (
  id           bigint generated always as identity primary key,
  room_id      uuid not null,
  game_no      int not null,
  result       text not null check (result in ('won', 'lost', 'abandoned')),
  level        int not null,
  max_level    int not null,
  player_ids   uuid[] not null,
  player_names text[] not null,
  finished_at  timestamptz not null default now()
);
create index if not exists game_results_players_idx on public.game_results using gin (player_ids);

-- Señal de cambios para el tiempo real: UNA fila por sala que se actualiza UNA vez por acción
-- (al final de la transacción) y solo contiene la versión. Así cada acción genera un único
-- mensaje de tiempo real por jugador, en vez de uno por cada UPDATE intermedio de `rooms`.
create table if not exists public.room_signals (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  version    bigint not null,
  updated_at timestamptz not null default now()
);

-- ───────────────────────────── Seguridad de tablas ─────────────────────────────

alter table public.room_signals      enable row level security;
alter table public.rooms             enable row level security;
alter table public.room_players      enable row level security;
alter table public.hands             enable row level security;
alter table public.room_events       enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.processed_actions enable row level security;
alter table public.join_attempts     enable row level security;
alter table public.game_results      enable row level security;

-- Nadie (salvo las funciones) puede escribir. Solo se concede lectura donde hace falta.
revoke all on table public.rooms, public.room_players, public.hands, public.room_events,
  public.chat_messages, public.processed_actions, public.join_attempts, public.game_results,
  public.room_signals
  from anon, authenticated, public;
grant select on table public.rooms, public.room_players, public.hands, public.room_events,
  public.chat_messages, public.room_signals to authenticated;

-- ¿Pertenece quien llama a la sala? (Usada por las políticas RLS.)
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.room_players
    where room_id = p_room and user_id = (select auth.uid())
  );
$$;

drop policy if exists rooms_select_members on public.rooms;
create policy rooms_select_members on public.rooms
  for select to authenticated using (public.is_room_member(id));

drop policy if exists players_select_members on public.room_players;
create policy players_select_members on public.room_players
  for select to authenticated using (public.is_room_member(room_id));

-- La política clave: cada uno solo ve SUS cartas.
drop policy if exists hands_select_own on public.hands;
create policy hands_select_own on public.hands
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists events_select_members on public.room_events;
create policy events_select_members on public.room_events
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists chat_select_members on public.chat_messages;
create policy chat_select_members on public.chat_messages
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists signals_select_members on public.room_signals;
create policy signals_select_members on public.room_signals
  for select to authenticated using (public.is_room_member(room_id));

-- ───────────────────────────── Reglas (espejo de gameConfig.ts) ─────────────────────────────

create or replace function game_private.jint(p jsonb, k text, d int, lo int, hi int)
returns int language sql immutable set search_path = ''
as $$
  select case
    when jsonb_typeof(p -> k) = 'number'
      then least(hi, greatest(lo, round((p ->> k)::numeric)))::int
    else d
  end;
$$;

create or replace function game_private.jenum(p jsonb, k text, opts text[], d text)
returns text language sql immutable set search_path = ''
as $$
  select case
    when jsonb_typeof(p -> k) = 'string' and (p ->> k) = any (opts) then p ->> k
    else d
  end;
$$;

create or replace function game_private.classic_rewards()
returns jsonb language sql immutable set search_path = ''
as $$
  select '[{"level":2,"lives":0,"shurikens":1},{"level":3,"lives":1,"shurikens":0},
           {"level":5,"lives":0,"shurikens":1},{"level":6,"lives":1,"shurikens":0},
           {"level":8,"lives":0,"shurikens":1},{"level":9,"lives":1,"shurikens":0}]'::jsonb;
$$;

create or replace function game_private.default_custom_rewards()
returns jsonb language sql immutable set search_path = ''
as $$
  select '[{"level":2,"lives":0,"shurikens":1},{"level":3,"lives":1,"shurikens":0},
           {"level":5,"lives":0,"shurikens":1},{"level":6,"lives":1,"shurikens":0}]'::jsonb;
$$;

create or replace function game_private.normalize_config(p_raw jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  p jsonb := case when jsonb_typeof(p_raw) = 'object' then p_raw else '{}'::jsonb end;
  v_rewards jsonb;
begin
  if jsonb_typeof(p -> 'customRewards') = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('level', lvl, 'lives', l, 'shurikens', s) order by lvl), '[]'::jsonb)
      into v_rewards
    from (
      select distinct on (lvl) lvl, l, s
      from (
        select game_private.jint(e, 'level', 1, 1, 12) as lvl,
               game_private.jint(e, 'lives', 0, 0, 3) as l,
               game_private.jint(e, 'shurikens', 0, 0, 3) as s,
               ord
        from jsonb_array_elements(p -> 'customRewards') with ordinality as t (e, ord)
        where ord <= 20 and jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'level') = 'number'
      ) x
      order by lvl, ord
    ) y
    where l > 0 or s > 0;
  else
    v_rewards := game_private.default_custom_rewards();
  end if;

  return jsonb_build_object(
    'maxPlayers',      game_private.jint(p, 'maxPlayers', 4, 2, 4),
    'levels',          game_private.jint(p, 'levels', 0, 0, 12),
    'mode',            game_private.jenum(p, 'mode', array['concentration', 'friends'], 'concentration'),
    'shurikenVariant', game_private.jenum(p, 'shurikenVariant', array['classic', 'reveal'], 'classic'),
    'rewardPreset',    game_private.jenum(p, 'rewardPreset', array['classic', 'custom', 'none'], 'classic'),
    'customRewards',   v_rewards,
    'maxLives',        game_private.jint(p, 'maxLives', 5, 1, 10),
    'maxShurikens',    game_private.jint(p, 'maxShurikens', 3, 0, 10),
    'difficulty',      game_private.jenum(p, 'difficulty', array['easy', 'classic', 'hard'], 'classic'),
    'countdown',       case when jsonb_typeof(p -> 'countdown') = 'boolean' then (p ->> 'countdown')::boolean else true end
  );
end;
$$;

-- 2 jugadores → 12 niveles, 2 vidas, 1 shuriken · 3 → 10, 3, 1 · 4 → 8, 4, 1
create or replace function game_private.starting_resources(p_config jsonb, p_players int)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  n int := least(4, greatest(2, p_players));
  v_levels int := case n when 2 then 12 when 3 then 10 else 8 end;
  v_lives int := n;
  v_sh int := 1;
  v_diff text := p_config ->> 'difficulty';
  -- Niveles elegidos (0 = todos), nunca más de los que permite el número de jugadores.
  v_req int := coalesce((p_config ->> 'levels')::int, 0);
begin
  if v_req >= 1 then v_levels := least(v_req, v_levels); end if;
  if v_diff = 'easy' then
    v_lives := v_lives + 1; v_sh := v_sh + 1;
  elsif v_diff = 'hard' then
    v_lives := greatest(1, v_lives - 1); v_sh := 0;
  end if;
  return jsonb_build_object(
    'maxLevel', v_levels,
    'lives', v_lives,
    'shurikens', v_sh,
    'livesCap', greatest((p_config ->> 'maxLives')::int, v_lives),
    'shurikensCap', greatest((p_config ->> 'maxShurikens')::int, v_sh)
  );
end;
$$;

create or replace function game_private.reward_for(p_config jsonb, p_level int)
returns jsonb language sql immutable set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('lives', (e ->> 'lives')::int, 'shurikens', (e ->> 'shurikens')::int)
       from jsonb_array_elements(
         case p_config ->> 'rewardPreset'
           when 'classic' then game_private.classic_rewards()
           when 'custom' then coalesce(p_config -> 'customRewards', '[]'::jsonb)
           else '[]'::jsonb
         end) as e
      where (e ->> 'level')::int = p_level
      limit 1),
    '{"lives":0,"shurikens":0}'::jsonb);
$$;

create or replace function game_private.clean_name(p text)
returns text language plpgsql immutable set search_path = ''
as $$
declare v text;
begin
  if p is null then return null; end if;
  v := regexp_replace(p, '[\x01-\x1f\x7f]', '', 'g');
  v := btrim(regexp_replace(v, '\s+', ' ', 'g'));
  if char_length(v) < 1 or char_length(v) > 20 then return null; end if;
  return v;
end;
$$;

-- ───────────────────────────── Utilidades internas ─────────────────────────────

create or replace function game_private.require_uid()
returns uuid language plpgsql stable set search_path = ''
as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return v;
end;
$$;

-- Bloquea la sala (orden único de procesamiento) y comprueba que quien llama es miembro.
create or replace function game_private.lock_room(p_room uuid, p_uid uuid)
returns public.rooms language plpgsql set search_path = ''
as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  update public.room_players set last_seen_at = now() where room_id = p_room and user_id = p_uid;
  if not found then raise exception 'NOT_MEMBER'; end if;
  return r;
end;
$$;

-- Último paso de cada acción: nueva versión de la sala + una única señal de tiempo real.
create or replace function game_private.touch(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare v_version bigint;
begin
  update public.rooms set version = version + 1, updated_at = now() where id = p_room
  returning version into v_version;
  if v_version is null then return; end if;
  insert into public.room_signals (room_id, version, updated_at) values (p_room, v_version, now())
  on conflict (room_id) do update set version = excluded.version, updated_at = excluded.updated_at;
end;
$$;

create or replace function game_private.emit(p_room uuid, p_kind text, p_actor uuid, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql set search_path = ''
as $$
declare v_seq int; v_game int;
begin
  update public.rooms set event_seq = event_seq + 1 where id = p_room returning event_seq, game_no into v_seq, v_game;
  update public.rooms
     set last_event = jsonb_build_object('seq', v_seq, 'kind', p_kind, 'actor', p_actor,
                                         'payload', coalesce(p_payload, '{}'::jsonb), 'at', now())
   where id = p_room;
  insert into public.room_events (room_id, seq, game_no, kind, actor, payload)
  values (p_room, v_seq, v_game, p_kind, p_actor, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- Lo que puede ver el jugador p_uid. Nunca incluye cartas ajenas.
create or replace function game_private.snapshot(p_room uuid, p_uid uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'serverTime', now(),
    'me', p_uid,
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'status', r.status, 'hostId', r.host_id, 'config', r.config,
      'gameNo', r.game_no, 'level', r.level, 'maxLevel', r.max_level, 'lives', r.lives,
      'shurikens', r.shurikens, 'version', r.version),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.user_id, 'name', p.name, 'seat', p.seat, 'ready', p.ready,
               'lastSeenAt', p.last_seen_at,
               'cardsLeft', (select count(*) from public.hands h where h.room_id = p.room_id and h.user_id = p.user_id)
             ) order by p.seat), '[]'::jsonb)
      from public.room_players p where p.room_id = r.id),
    'pile', r.pile,
    'revealed', r.revealed,
    'vote', r.vote,
    'lastEvent', r.last_event,
    -- Últimos 8 eventos (una acción puede generar varios, p. ej. «error» + «nivel superado»).
    'recentEvents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'seq', e.seq, 'kind', e.kind, 'actor', e.actor, 'payload', e.payload, 'at', e.created_at
             ) order by e.seq), '[]'::jsonb)
      from (select * from public.room_events ev where ev.room_id = r.id order by ev.seq desc limit 8) e),
    'lastReward', r.last_reward,
    'myHand', (
      select coalesce(jsonb_agg(h.card order by h.card), '[]'::jsonb)
      from public.hands h where h.room_id = r.id and h.user_id = p_uid)
  )
  from public.rooms r where r.id = p_room;
$$;

-- Baraja 1..100 con aleatoriedad criptográfica y reparte `level` cartas en rueda.
create or replace function game_private.deal(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare v_level int;
begin
  select level into v_level from public.rooms where id = p_room;
  delete from public.hands where room_id = p_room;
  insert into public.hands (room_id, user_id, card)
  select p_room, s.user_id, d.card
  from (
    select g as card, (row_number() over (order by gen_random_uuid()) - 1)::int as i
    from generate_series(1, 100) as g
  ) d
  join (
    select user_id, (row_number() over (order by seat) - 1)::int as idx, (count(*) over ())::int as n
    from public.room_players where room_id = p_room
  ) s on d.i % s.n = s.idx
  where d.i < s.n * v_level;
  update public.rooms set pile = '[]'::jsonb, revealed = '[]'::jsonb, vote = null, last_reward = null where id = p_room;
  update public.room_players set ready = false where room_id = p_room;
end;
$$;

create or replace function game_private.end_game(p_room uuid, p_status text)
returns void language plpgsql set search_path = ''
as $$
declare r public.rooms;
begin
  update public.rooms set status = p_status, vote = null where id = p_room returning * into r;
  delete from public.hands where room_id = p_room;
  perform game_private.emit(p_room, p_status, null, jsonb_build_object('level', r.level));
  insert into public.game_results (room_id, game_no, result, level, max_level, player_ids, player_names)
  select r.id, r.game_no, p_status, r.level, r.max_level,
         coalesce(array_agg(p.user_id order by p.seat), '{}'),
         coalesce(array_agg(p.name order by p.seat), '{}')
  from public.room_players p where p.room_id = p_room;
end;
$$;

create or replace function game_private.check_level_end(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  r public.rooms;
  v_reward jsonb;
  v_lives int;
  v_sh int;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' then return; end if;
  if exists (select 1 from public.hands where room_id = p_room) then return; end if;
  if r.level >= r.max_level then
    perform game_private.end_game(p_room, 'won');
    return;
  end if;
  v_reward := game_private.reward_for(r.config, r.level);
  v_lives := least(r.lives + (v_reward ->> 'lives')::int, greatest(r.lives_cap, r.lives));
  v_sh := least(r.shurikens + (v_reward ->> 'shurikens')::int, greatest(r.shurikens_cap, r.shurikens));
  update public.rooms
     set lives = v_lives, shurikens = v_sh, status = 'level_complete', vote = null,
         last_reward = jsonb_build_object('level', r.level, 'lives', v_lives - r.lives, 'shurikens', v_sh - r.shurikens)
   where id = p_room;
  update public.room_players set ready = false where room_id = p_room;
  perform game_private.emit(p_room, 'level_complete', null, jsonb_build_object(
    'level', r.level,
    'reward', jsonb_build_object('lives', v_lives - r.lives, 'shurikens', v_sh - r.shurikens)));
end;
$$;

create or replace function game_private.start_next_level(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare v_level int;
begin
  update public.rooms set level = level + 1, status = 'playing' where id = p_room returning level into v_level;
  perform game_private.deal(p_room);
  perform game_private.emit(p_room, 'level_start', null, jsonb_build_object('level', v_level));
end;
$$;

create or replace function game_private.maybe_advance(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.rooms where id = p_room and status = 'level_complete')
     and exists (select 1 from public.room_players where room_id = p_room)
     and not exists (select 1 from public.room_players where room_id = p_room and not ready) then
    perform game_private.start_next_level(p_room);
  end if;
end;
$$;

create or replace function game_private.expire_if_due(p_room uuid)
returns boolean language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.rooms
             where id = p_room and vote is not null and (vote ->> 'expiresAt')::timestamptz <= now()) then
    update public.rooms set vote = null where id = p_room;
    perform game_private.emit(p_room, 'shuriken_cancelled', null, '{"reason":"expired"}'::jsonb);
    return true;
  end if;
  return false;
end;
$$;

create or replace function game_private.all_voted(p_room uuid)
returns boolean language sql stable set search_path = ''
as $$
  select not exists (
    select 1 from public.room_players p
    where p.room_id = p_room
      and not coalesce((select r.vote -> 'votes' from public.rooms r where r.id = p_room) ? p.user_id::text, false)
  );
$$;

create or replace function game_private.execute_shuriken(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  v_reveal boolean;
  v_discarded jsonb;
begin
  select (config ->> 'shurikenVariant') = 'reveal' into v_reveal from public.rooms where id = p_room;

  with lowest as (
    select distinct on (h.user_id) h.user_id, h.card, p.seat
    from public.hands h
    join public.room_players p on p.room_id = h.room_id and p.user_id = h.user_id
    where h.room_id = p_room
    order by h.user_id, h.card
  ),
  removed as (
    delete from public.hands h using lowest l
    where h.room_id = p_room and h.card = l.card
    returning h.card
  )
  select coalesce(jsonb_agg(
           case when v_reveal then jsonb_build_object('p', l.user_id, 'c', l.card)
                else jsonb_build_object('p', l.user_id) end
           order by l.seat), '[]'::jsonb)
    into v_discarded
  from lowest l;

  if v_reveal then
    update public.rooms
       set revealed = revealed || (
         select coalesce(jsonb_agg(jsonb_build_object('c', e -> 'c', 'p', e -> 'p', 'r', 'shuriken') order by ord), '[]'::jsonb)
         from jsonb_array_elements(v_discarded) with ordinality as t (e, ord))
     where id = p_room;
  end if;
  update public.rooms set shurikens = shurikens - 1, vote = null where id = p_room;
  perform game_private.emit(p_room, 'shuriken_used', null, jsonb_build_object('discarded', v_discarded));
  perform game_private.check_level_end(p_room);
end;
$$;

-- Saca a un jugador (abandono o expulsión). La sala debe estar bloqueada.
-- Devuelve false si la sala se ha quedado vacía y se ha borrado.
create or replace function game_private.remove_player(p_room uuid, p_target uuid, p_reason text)
returns boolean language plpgsql set search_path = ''
as $$
declare
  v_name text;
  v_cards int;
  v_count int;
  r public.rooms;
  v_new_host uuid;
begin
  select name into v_name from public.room_players where room_id = p_room and user_id = p_target;
  if not found then raise exception 'NOT_MEMBER'; end if;
  select count(*) into v_cards from public.hands where room_id = p_room and user_id = p_target;
  delete from public.hands where room_id = p_room and user_id = p_target;
  delete from public.room_players where room_id = p_room and user_id = p_target;
  perform game_private.emit(p_room, case p_reason when 'kicked' then 'player_kicked' else 'player_left' end,
                            p_target, jsonb_build_object('name', v_name, 'cards', v_cards));

  select count(*) into v_count from public.room_players where room_id = p_room;
  if v_count = 0 then
    delete from public.rooms where id = p_room;
    return false;
  end if;

  select * into r from public.rooms where id = p_room;
  if r.host_id = p_target then
    select user_id into v_new_host from public.room_players where room_id = p_room order by seat limit 1;
    update public.rooms set host_id = v_new_host where id = p_room;
    perform game_private.emit(p_room, 'host_changed', v_new_host, '{}'::jsonb);
  end if;
  if r.vote is not null then
    update public.rooms set vote = null where id = p_room;
    perform game_private.emit(p_room, 'shuriken_cancelled', null, '{"reason":"player_left"}'::jsonb);
  end if;
  if r.status in ('playing', 'level_complete') then
    if v_count < 2 then
      perform game_private.end_game(p_room, 'abandoned');
      -- Quien se fue también jugó esa partida: que aparezca en su historial.
      update public.game_results
         set player_ids = player_ids || p_target, player_names = player_names || v_name
       where id = (select max(id) from public.game_results where room_id = p_room);
    elsif r.status = 'playing' then
      perform game_private.check_level_end(p_room);
    else
      perform game_private.maybe_advance(p_room);
    end if;
  end if;
  return true;
end;
$$;

create or replace function game_private.new_code()
returns text language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin I, O, 0, 1
  v text;
begin
  for attempt in 1..30 loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '')
      into v from generate_series(1, 5);
    if not exists (select 1 from public.rooms where code = v) then return v; end if;
  end loop;
  raise exception 'INVALID_STATE';
end;
$$;

-- ───────────────────────────── API pública (RPC) ─────────────────────────────

create or replace function public.create_room(p_name text, p_config jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_name text := game_private.clean_name(p_name);
  v_room uuid;
begin
  if v_name is null then raise exception 'INVALID_NAME'; end if;
  if (select count(*) from public.rooms
      where created_by = v_uid and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'TOO_MANY_ROOMS';
  end if;

  -- Limpieza oportunista: salas inactivas y registros antiguos.
  delete from public.rooms where updated_at < now() - interval '12 hours';
  delete from public.join_attempts where created_at < now() - interval '1 day';
  delete from public.processed_actions where created_at < now() - interval '1 day';

  insert into public.rooms (code, host_id, created_by, config)
  values (game_private.new_code(), v_uid, v_uid, game_private.normalize_config(p_config))
  returning id into v_room;
  insert into public.room_players (room_id, user_id, name, seat) values (v_room, v_uid, v_name, 1);
  return game_private.snapshot(v_room, v_uid);
end;
$$;

create or replace function public.join_room(p_code text, p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_name text;
  r public.rooms;
  v_count int;
  v_seat int;
begin
  if (select count(*) from public.join_attempts
      where user_id = v_uid and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;

  select * into r from public.rooms where code = v_code for update;
  if not found then
    -- Se devuelve (en vez de lanzar) para que el intento fallido quede registrado.
    insert into public.join_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'ROOM_NOT_FOUND');
  end if;

  -- Reconexión: si ya era miembro, recupera su sitio.
  update public.room_players set last_seen_at = now() where room_id = r.id and user_id = v_uid;
  if found then return game_private.snapshot(r.id, v_uid); end if;

  v_name := game_private.clean_name(p_name);
  if v_name is null then raise exception 'INVALID_NAME'; end if;
  if r.status <> 'lobby' then raise exception 'GAME_IN_PROGRESS'; end if;
  select count(*), coalesce(max(seat), 0) + 1 into v_count, v_seat from public.room_players where room_id = r.id;
  if v_count >= (r.config ->> 'maxPlayers')::int then raise exception 'ROOM_FULL'; end if;

  insert into public.room_players (room_id, user_id, name, seat) values (r.id, v_uid, v_name, v_seat);
  perform game_private.emit(r.id, 'player_joined', v_uid, jsonb_build_object('name', v_name));
  perform game_private.touch(r.id);
  return game_private.snapshot(r.id, v_uid);
end;
$$;

create or replace function public.get_room_state(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  if not exists (select 1 from public.room_players where room_id = p_room and user_id = v_uid) then
    raise exception 'NOT_MEMBER';
  end if;
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.update_config(p_room uuid, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
  v_cfg jsonb := game_private.normalize_config(p_config);
  v_count int;
begin
  if r.host_id <> v_uid then raise exception 'NOT_HOST'; end if;
  if r.status <> 'lobby' then raise exception 'NOT_IN_LOBBY'; end if;
  select count(*) into v_count from public.room_players where room_id = p_room;
  v_cfg := jsonb_set(v_cfg, '{maxPlayers}', to_jsonb(greatest((v_cfg ->> 'maxPlayers')::int, v_count)));
  update public.rooms set config = v_cfg where id = p_room;
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.set_lobby_ready(p_room uuid, p_ready boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if r.status <> 'lobby' then raise exception 'NOT_IN_LOBBY'; end if;
  update public.room_players set ready = coalesce(p_ready, false) where room_id = p_room and user_id = v_uid;
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.start_game(p_room uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
  v_count int;
  v_res jsonb;
begin
  if r.host_id <> v_uid then raise exception 'NOT_HOST'; end if;
  if r.status <> 'lobby' then raise exception 'NOT_IN_LOBBY'; end if;
  select count(*) into v_count from public.room_players where room_id = p_room;
  if v_count < 2 then raise exception 'NOT_ENOUGH_PLAYERS'; end if;
  -- Todos (anfitrión incluido) deben haber marcado «Listo».
  if exists (select 1 from public.room_players where room_id = p_room and not ready) then
    raise exception 'NOT_ALL_READY';
  end if;
  v_res := game_private.starting_resources(r.config, v_count);
  update public.rooms
     set game_no = game_no + 1, level = 1, status = 'playing',
         max_level = (v_res ->> 'maxLevel')::int,
         lives = (v_res ->> 'lives')::int,
         shurikens = (v_res ->> 'shurikens')::int,
         lives_cap = (v_res ->> 'livesCap')::int,
         shurikens_cap = (v_res ->> 'shurikensCap')::int
   where id = p_room;
  perform game_private.deal(p_room);
  perform game_private.emit(p_room, 'game_start', v_uid,
    jsonb_build_object('level', 1, 'maxLevel', (v_res ->> 'maxLevel')::int));
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

-- Juega la carta p_card. Debe ser la más baja de la mano de quien llama.
-- p_action: identificador único de la pulsación (los reintentos con el mismo id se ignoran).
create or replace function public.play_card(p_room uuid, p_card int, p_action uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
  v_lowest int;
  v_lower jsonb;
  v_lives int;
begin
  if p_action is not null then
    insert into public.processed_actions (user_id, action_id, room_id) values (v_uid, p_action, p_room)
    on conflict do nothing;
    if not found then return game_private.snapshot(p_room, v_uid); end if;
  end if;

  if r.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
  perform game_private.expire_if_due(p_room);
  if exists (select 1 from public.rooms where id = p_room and vote is not null) then
    raise exception 'VOTE_IN_PROGRESS';
  end if;

  select min(card) into v_lowest from public.hands where room_id = p_room and user_id = v_uid;
  if v_lowest is null then raise exception 'NO_CARDS'; end if;
  if p_card is distinct from v_lowest then
    if exists (select 1 from public.hands where room_id = p_room and user_id = v_uid and card = p_card) then
      raise exception 'NOT_LOWEST';
    end if;
    raise exception 'NOT_IN_HAND';
  end if;

  delete from public.hands where room_id = p_room and card = p_card;
  update public.rooms set pile = pile || jsonb_build_array(jsonb_build_object('c', p_card, 'p', v_uid))
   where id = p_room;

  -- ¿Alguien tenía cartas menores? Error: se descartan TODAS y se pierde UNA vida.
  with removed as (
    delete from public.hands where room_id = p_room and card < p_card returning card, user_id
  )
  select jsonb_agg(jsonb_build_object('c', card, 'p', user_id) order by card) into v_lower from removed;

  if v_lower is not null then
    update public.rooms
       set lives = lives - 1,
           revealed = revealed || (
             select jsonb_agg(e || '{"r":"mistake"}'::jsonb order by ord)
             from jsonb_array_elements(v_lower) with ordinality as t (e, ord))
     where id = p_room
     returning lives into v_lives;
    perform game_private.emit(p_room, 'mistake', v_uid,
      jsonb_build_object('card', p_card, 'discarded', v_lower, 'lives', v_lives));
    if v_lives <= 0 then
      perform game_private.end_game(p_room, 'lost');
      perform game_private.touch(p_room);
      return game_private.snapshot(p_room, v_uid);
    end if;
  else
    perform game_private.emit(p_room, 'play', v_uid, jsonb_build_object('card', p_card));
  end if;

  perform game_private.check_level_end(p_room);
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.propose_shuriken(p_room uuid, p_action uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if p_action is not null then
    insert into public.processed_actions (user_id, action_id, room_id) values (v_uid, p_action, p_room)
    on conflict do nothing;
    if not found then return game_private.snapshot(p_room, v_uid); end if;
  end if;
  if r.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
  perform game_private.expire_if_due(p_room);
  if exists (select 1 from public.rooms where id = p_room and vote is not null) then
    raise exception 'VOTE_IN_PROGRESS';
  end if;
  if r.shurikens <= 0 then raise exception 'NO_SHURIKENS'; end if;

  update public.rooms
     set vote = jsonb_build_object('proposer', v_uid, 'votes', jsonb_build_array(v_uid),
                                   'expiresAt', now() + interval '15 seconds')
   where id = p_room;
  perform game_private.emit(p_room, 'shuriken_proposed', v_uid, '{}'::jsonb);
  if game_private.all_voted(p_room) then perform game_private.execute_shuriken(p_room); end if;
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.vote_shuriken(p_room uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if r.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
  if game_private.expire_if_due(p_room) then
    perform game_private.touch(p_room);
    return game_private.snapshot(p_room, v_uid);
  end if;
  if r.vote is null then raise exception 'NO_VOTE'; end if;

  if not coalesce(p_accept, false) then
    update public.rooms set vote = null where id = p_room;
    perform game_private.emit(p_room, 'shuriken_cancelled', v_uid, '{"reason":"rejected"}'::jsonb);
    perform game_private.touch(p_room);
    return game_private.snapshot(p_room, v_uid);
  end if;

  if (r.vote -> 'votes') ? v_uid::text then
    return game_private.snapshot(p_room, v_uid); -- voto repetido: sin efecto
  end if;
  update public.rooms
     set vote = jsonb_set(vote, '{votes}', (vote -> 'votes') || to_jsonb(v_uid::text))
   where id = p_room;
  if game_private.all_voted(p_room) then perform game_private.execute_shuriken(p_room); end if;
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.expire_shuriken_vote(p_room uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if r.vote is not null and game_private.expire_if_due(p_room) then
    perform game_private.touch(p_room);
  end if;
  return game_private.snapshot(p_room, v_uid);
end;
$$;

-- p_level es el nivel recién superado: una petición repetida o tardía no tiene efecto.
create or replace function public.ready_next_level(p_room uuid, p_level int, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if r.status <> 'level_complete' or r.level <> p_level then
    return game_private.snapshot(p_room, v_uid);
  end if;
  update public.room_players set ready = true where room_id = p_room and user_id = v_uid;
  if coalesce(p_force, false) and r.host_id = v_uid then
    perform game_private.start_next_level(p_room);
  else
    perform game_private.maybe_advance(p_room);
  end if;
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.leave_room(p_room uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if game_private.remove_player(p_room, v_uid, 'left') then
    perform game_private.touch(p_room);
  end if;
  return jsonb_build_object('left', true, 'status', r.status);
end;
$$;

create or replace function public.kick_player(p_room uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if r.host_id <> v_uid then raise exception 'NOT_HOST'; end if;
  if p_target = v_uid then raise exception 'CANNOT_KICK_SELF'; end if;
  perform game_private.remove_player(p_room, p_target, 'kicked');
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.rematch(p_room uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if r.host_id <> v_uid then raise exception 'NOT_HOST'; end if;
  if r.status not in ('won', 'lost', 'abandoned') then raise exception 'INVALID_STATE'; end if;
  delete from public.hands where room_id = p_room;
  update public.rooms
     set status = 'lobby', level = 0, max_level = 0, lives = 0, shurikens = 0, lives_cap = 0, shurikens_cap = 0,
         pile = '[]'::jsonb, revealed = '[]'::jsonb, vote = null, last_reward = null
   where id = p_room;
  update public.room_players set ready = false where room_id = p_room;
  perform game_private.emit(p_room, 'rematch', v_uid, '{}'::jsonb);
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

-- Señal de vida cada ~15 s. Si el anfitrión lleva > 45 s sin dar señales, el rol pasa
-- al jugador conectado con el asiento más bajo. Devuelve la versión para detectar
-- cambios perdidos.
create or replace function public.heartbeat(p_room uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_host uuid;
  v_host_seen timestamptz;
  v_new_host uuid;
begin
  update public.room_players set last_seen_at = now() where room_id = p_room and user_id = v_uid;
  if not found then raise exception 'NOT_MEMBER'; end if;

  select r.host_id, hp.last_seen_at into v_host, v_host_seen
  from public.rooms r
  left join public.room_players hp on hp.room_id = r.id and hp.user_id = r.host_id
  where r.id = p_room;

  if v_host <> v_uid and (v_host_seen is null or v_host_seen < now() - interval '45 seconds') then
    perform 1 from public.rooms where id = p_room for update;
    select user_id into v_new_host from public.room_players
     where room_id = p_room and last_seen_at >= now() - interval '45 seconds'
     order by seat limit 1;
    if v_new_host is not null and v_new_host <> v_host then
      update public.rooms set host_id = v_new_host where id = p_room;
      perform game_private.emit(p_room, 'host_changed', v_new_host, '{}'::jsonb);
      perform game_private.touch(p_room);
    end if;
  end if;

  return jsonb_build_object('version', (select version from public.rooms where id = p_room));
end;
$$;

create or replace function public.send_chat(p_room uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_name text;
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x1f\x7f]', ' ', 'g'));
begin
  select p.name into v_name from public.room_players p where p.room_id = p_room and p.user_id = v_uid;
  if not found then raise exception 'NOT_MEMBER'; end if;
  if (select config ->> 'mode' from public.rooms where id = p_room) <> 'friends' then
    raise exception 'CHAT_DISABLED';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 200 then raise exception 'INVALID_MESSAGE'; end if;
  if exists (select 1 from public.chat_messages
             where room_id = p_room and user_id = v_uid and created_at > now() - interval '1 second') then
    raise exception 'TOO_FAST';
  end if;
  insert into public.chat_messages (room_id, user_id, name, body) values (p_room, v_uid, v_name, v_body);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_my_history()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  return jsonb_build_object(
    'stats', (
      select jsonb_build_object(
        'played', count(*),
        'won', count(*) filter (where result = 'won'),
        'bestLevel', coalesce(max(level), 0))
      from public.game_results where v_uid = any (player_ids)),
    'games', (
      select coalesce(jsonb_agg(g order by g."finishedAt" desc), '[]'::jsonb)
      from (
        select result, level, max_level as "maxLevel", player_names as "players", finished_at as "finishedAt"
        from public.game_results where v_uid = any (player_ids)
        order by finished_at desc limit 20
      ) g)
  );
end;
$$;

-- ───────────────────────────── Permisos de funciones ─────────────────────────────

revoke all on all functions in schema game_private from public, anon, authenticated;

revoke all on function
  public.is_room_member(uuid),
  public.create_room(text, jsonb),
  public.join_room(text, text),
  public.get_room_state(uuid),
  public.update_config(uuid, jsonb),
  public.set_lobby_ready(uuid, boolean),
  public.start_game(uuid),
  public.play_card(uuid, int, uuid),
  public.propose_shuriken(uuid, uuid),
  public.vote_shuriken(uuid, boolean),
  public.expire_shuriken_vote(uuid),
  public.ready_next_level(uuid, int, boolean),
  public.leave_room(uuid),
  public.kick_player(uuid, uuid),
  public.rematch(uuid),
  public.heartbeat(uuid),
  public.send_chat(uuid, text),
  public.get_my_history()
from public, anon;

grant execute on function
  public.is_room_member(uuid),
  public.create_room(text, jsonb),
  public.join_room(text, text),
  public.get_room_state(uuid),
  public.update_config(uuid, jsonb),
  public.set_lobby_ready(uuid, boolean),
  public.start_game(uuid),
  public.play_card(uuid, int, uuid),
  public.propose_shuriken(uuid, uuid),
  public.vote_shuriken(uuid, boolean),
  public.expire_shuriken_vote(uuid),
  public.ready_next_level(uuid, int, boolean),
  public.leave_room(uuid),
  public.kick_player(uuid, uuid),
  public.rematch(uuid),
  public.heartbeat(uuid),
  public.send_chat(uuid, text),
  public.get_my_history()
to authenticated;

-- ───────────────────────────── Tiempo real ─────────────────────────────
-- Solo se emiten la señal de versión de la sala y el chat. `hands` NUNCA se publica.
-- (Versiones anteriores publicaban `rooms`; se retira para no gastar mensajes.)

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
      alter publication supabase_realtime drop table public.rooms;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_signals') then
      alter publication supabase_realtime add table public.room_signals;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
  end if;
end;
$$;
