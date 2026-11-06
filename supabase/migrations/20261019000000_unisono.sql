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
  vote          jsonb,                                -- {kind, proposer, votes[], expiresAt}
  last_event    jsonb,
  last_reward   jsonb,
  event_seq     int not null default 0,
  version       bigint not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rooms_created_by_idx on public.rooms (created_by, created_at);
create index if not exists rooms_updated_at_idx on public.rooms (updated_at);
-- Añadida después: quién no puede volver a proponer shuriken hasta que se juegue una carta.
alter table public.rooms add column if not exists shuriken_blocked jsonb not null default '[]'::jsonb;
-- Añadidas después: comodines Rebobinar y Escudo, escudo activo en el nivel y elección de
-- comodín pendiente tras superar un nivel ({choices[], left, votes{uid: tipo}}).
alter table public.rooms add column if not exists rewinds int not null default 0;
alter table public.rooms add column if not exists shields int not null default 0;
alter table public.rooms add column if not exists shield_active boolean not null default false;
alter table public.rooms add column if not exists offer jsonb;
-- Añadidas después: ronda relámpago (nivel en que toca, 0 = ninguno, y hora límite mientras se juega).
alter table public.rooms add column if not exists lightning_level int not null default 0;
alter table public.rooms add column if not exists lightning_ends_at timestamptz;
-- Añadida después: cuándo se jugó la última carta (la ronda final solo deja verla unos segundos).
alter table public.rooms add column if not exists pile_at timestamptz;
-- Añadida después: jugadores al empezar la partida (para calcular las monedas de la recompensa).
alter table public.rooms add column if not exists start_players int not null default 0;
-- Añadidas después (logros): errores y vidas perdidas del nivel en juego (vuelven a 0 al repartir) y
-- vistazos usados y vidas perdidas en toda la partida (vuelven a 0 al empezarla).
alter table public.rooms add column if not exists level_mistakes int not null default 0;
alter table public.rooms add column if not exists level_lives_lost int not null default 0;
alter table public.rooms add column if not exists game_shurikens_used int not null default 0;
alter table public.rooms add column if not exists game_lives_lost int not null default 0;
-- Quitada después: la opción de vistazo «clásico» (descartes ocultos); ahora siempre se muestran.
update public.rooms set config = config - 'shurikenVariant' where config ? 'shurikenVariant';

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
-- Añadidas después: cartas jugadas en la partida actual (para cobrar hay que haber participado) y
-- diseño de cartas con el que juega (se fija al empezar la partida: cambiarlo afecta a la siguiente).
alter table public.room_players add column if not exists cards_played int not null default 0;
alter table public.room_players add column if not exists card_design text not null default 'classic';

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
create index if not exists game_results_room_idx on public.game_results (room_id, game_no);

-- Señal de cambios para el tiempo real: UNA fila por sala que se actualiza UNA vez por acción
-- (al final de la transacción) y solo contiene la versión. Así cada acción genera un único
-- mensaje de tiempo real por jugador, en vez de uno por cada UPDATE intermedio de `rooms`.
create table if not exists public.room_signals (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  version    bigint not null,
  updated_at timestamptz not null default now()
);

-- ───────────────────────────── Economía: monedas y cosméticos ─────────────────────────────
-- Todo es del servidor: el saldo, los precios, lo que posee cada jugador y las recompensas.
-- Ninguna tabla se puede escribir desde la app; solo las funciones de más abajo, que cambian el
-- saldo SIEMPRE a través de game_private.add_coins (que apunta cada movimiento).

-- Catálogo. `kind` permite futuros tipos (marcos, efectos…) y `unlock` otras formas de
-- conseguirlos (logros, eventos…). El aspecto de cada diseño vive en la app (CSS), por su id.
create table if not exists public.cosmetics (
  id           text primary key check (id ~ '^[a-z0-9_]{2,32}$'),
  kind         text not null check (kind in ('card_design')),
  name         text not null,
  description  text not null,
  price        int check (price is null or price >= 0),
  unlock       text not null check (unlock in ('default', 'coins', 'achievement', 'event')),
  sort         int not null default 0,
  is_available boolean not null default true,
  created_at   timestamptz not null default now(),
  check (unlock <> 'coins' or price is not null)
);

-- Añadidos después: los títulos (otro tipo de cosmético, en el mismo inventario) y la rareza,
-- que solo cambia cómo se ven en la app.
alter table public.cosmetics drop constraint if exists cosmetics_kind_check;
alter table public.cosmetics add constraint cosmetics_kind_check check (kind in ('card_design', 'title'));
alter table public.cosmetics add column if not exists rarity text not null default 'common'
  check (rarity in ('common', 'rare', 'epic', 'legendary'));

-- Catálogo. Para cambiar un precio o un texto, se cambia aquí y se vuelve a ejecutar.
-- Los diseños con unlock = 'achievement' no se venden: los da el logro que los tiene de premio
-- (tabla achievement_cosmetics, más abajo).
insert into public.cosmetics (id, kind, name, description, price, unlock, rarity, sort) values
  ('classic', 'card_design', 'Clásico', 'El diseño de siempre: papel cálido y el color de cada número.', null, 'default', 'common', 0),
  ('galaxy', 'card_design', 'Galaxia', 'Cartas llegadas del espacio profundo: nebulosas, estrellas y polvo cósmico.', 10, 'coins', 'common', 1),
  ('neon', 'card_design', 'Neón', 'Rejilla futurista, bordes eléctricos y números que brillan en la oscuridad.', 30, 'coins', 'rare', 2),
  ('emerald', 'card_design', 'Esmeralda', 'Terciopelo verde, filigrana dorada y acabado de joya. El más exclusivo de la tienda.', 50, 'coins', 'epic', 3),
  ('obsidian', 'card_design', 'Obsidiana', 'Piedra volcánica pulida, vetas de magma y filos de acero. Solo para quien ya es de la casa.', null, 'achievement', 'rare', 10),
  ('aurora', 'card_design', 'Aurora', 'Cortinas de luz boreal sobre un cielo polar. Brilla como cada victoria.', null, 'achievement', 'epic', 11),
  ('chrono', 'card_design', 'Crono', 'Esfera de reloj, engranajes de plata y el tiempo bajo control. El tiempo no espera a nadie; tú tampoco.', null, 'achievement', 'epic', 12),
  ('phoenix', 'card_design', 'Fénix', 'Plumas de fuego y oro que renacen en cada partida. Para quien nunca se rinde.', null, 'achievement', 'legendary', 13),
  ('transcendence', 'card_design', 'Trascendencia', 'Geometría celeste, marfil y oro. El diseño más difícil de conseguir.', null, 'achievement', 'legendary', 14),
  ('title_apprentice', 'title', 'Aprendiz', 'Todos empezamos por la primera carta.', 10, 'coins', 'common', 100),
  ('title_observer', 'title', 'Observador', 'Nada se le escapa: ni una mirada, ni un titubeo.', 20, 'coins', 'common', 101),
  ('title_strategist', 'title', 'Estratega', 'Cada carta, en su momento justo.', 35, 'coins', 'common', 102),
  ('title_visionary', 'title', 'Visionario', 'Ve venir el siguiente número antes que nadie.', 50, 'coins', 'rare', 103),
  ('title_mastermind', 'title', 'Mente Maestra', 'Piensa tres jugadas por delante.', 75, 'coins', 'rare', 104),
  ('title_unstoppable', 'title', 'Imparable', 'Nivel tras nivel, sin pisar el freno.', 100, 'coins', 'rare', 105),
  ('title_legend', 'title', 'Leyenda', 'Sus partidas se cuentan en la sala de espera.', 150, 'coins', 'epic', 106),
  ('title_chosen', 'title', 'El Elegido', 'Las cartas parecen buscarle.', 200, 'coins', 'epic', 107),
  ('title_oracle', 'title', 'Oráculo', 'Sabe qué número viene sin que nadie lo diga.', 250, 'coins', 'epic', 108),
  ('title_timekeeper', 'title', 'Maestro del Tiempo', 'Domina el silencio entre carta y carta.', 300, 'coins', 'legendary', 109),
  ('title_sync', 'title', 'Sincronía Perfecta', 'Cuando juega, el equipo late a la vez.', 400, 'coins', 'legendary', 110),
  ('title_last_mind', 'title', 'La Última Mente', 'La leyenda que cierra cada partida.', 500, 'coins', 'legendary', 111)
on conflict (id) do update
  set kind = excluded.kind, name = excluded.name, description = excluded.description,
      price = excluded.price, unlock = excluded.unlock, rarity = excluded.rarity, sort = excluded.sort;

-- Saldo de cada jugador (nunca negativo).
create table if not exists public.player_wallets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  coins      int not null default 0 check (coins >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cosméticos que posee cada jugador (el clásico se da a todos).
create table if not exists public.player_cosmetics (
  user_id     uuid not null references auth.users (id) on delete cascade,
  cosmetic_id text not null references public.cosmetics (id),
  source      text not null check (source in ('default', 'purchase', 'achievement', 'event', 'reward')),
  acquired_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

-- Cosmético equipado de cada tipo. La clave ajena a player_cosmetics impide equipar algo que
-- no se posee (la propiedad y lo equipado son cosas distintas).
create table if not exists public.player_equipped (
  user_id     uuid not null,
  kind        text not null,
  cosmetic_id text not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind),
  foreign key (user_id, cosmetic_id) references public.player_cosmetics (user_id, cosmetic_id) on delete cascade
);

-- Registro de TODOS los movimientos de monedas.
create table if not exists public.coin_transactions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  amount        int not null check (amount <> 0),
  balance_after int not null check (balance_after >= 0),
  kind          text not null check (kind in ('match_reward', 'purchase', 'adjustment')),
  reason        text not null,
  match_id      bigint references public.game_results (id) on delete set null,
  cosmetic_id   text references public.cosmetics (id),
  created_at    timestamptz not null default now()
);
create index if not exists coin_transactions_user_idx on public.coin_transactions (user_id, id desc);
-- Añadido después: las monedas de los logros.
alter table public.coin_transactions drop constraint if exists coin_transactions_kind_check;
alter table public.coin_transactions add constraint coin_transactions_kind_check
  check (kind in ('match_reward', 'purchase', 'adjustment', 'achievement'));

-- Recompensa de cada jugador en cada partida. UNA como mucho (match_id, user_id): no se puede
-- cobrar dos veces. Se guarda aunque sea 0, con el desglose, para la pantalla final.
create table if not exists public.match_rewards (
  id             bigint generated always as identity primary key,
  match_id       bigint not null references public.game_results (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  coins          int not null check (coins >= 0),
  breakdown      jsonb not null,
  balance_before int not null,
  balance_after  int not null,
  created_at     timestamptz not null default now(),
  unique (match_id, user_id)
);
create index if not exists match_rewards_user_idx on public.match_rewards (user_id);

-- ───────────────────────────── Logros y estadísticas ─────────────────────────────
-- Todo lo cuenta el servidor a partir de las partidas online (la práctica no cuenta):
--   * player_stats: los contadores de cada jugador (acumulados, rachas y récords).
--   * achievements: el catálogo. Cada logro es «métrica >= objetivo» (game_private.metric_value),
--     así que añadir uno nuevo es añadir una fila (y, si hace falta, una métrica).
--   * achievement_cosmetics: cosméticos (cartas o títulos) que da cada logro, además de monedas.
--   * player_achievements: los conseguidos (una vez por jugador) y si ya se han enseñado.
--   * progress_events: cada nivel superado y cada partida terminada se apunta UNA vez por jugador;
--     un reintento o una reconexión no pueden sumar dos veces.
create table if not exists public.achievements (
  id           text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  category     text not null check (category in ('games', 'wins', 'progress', 'skill', 'team', 'special')),
  name         text not null,
  description  text not null,
  condition    text not null,
  metric       text not null,
  target       int not null check (target >= 1),
  reward_coins int not null default 0 check (reward_coins >= 0),
  sort         int not null default 0,
  is_secret    boolean not null default false,
  is_available boolean not null default true
);

create table if not exists public.achievement_cosmetics (
  achievement_id text not null references public.achievements (id) on delete cascade,
  cosmetic_id    text not null references public.cosmetics (id),
  primary key (achievement_id, cosmetic_id)
);

create table if not exists public.player_stats (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  games_completed   int not null default 0, -- partidas terminadas (ganadas o perdidas) habiendo jugado
  wins              int not null default 0,
  win_streak        int not null default 0, -- victorias seguidas (una derrota la corta)
  best_win_streak   int not null default 0,
  levels_completed  int not null default 0, -- niveles superados estando en la sala
  team_levels       int not null default 0, -- niveles superados en partidas de 3 o más jugadores
  clean_streak      int not null default 0, -- niveles superados seguidos sin NINGÚN error
  best_clean_streak int not null default 0,
  safe_streak       int not null default 0, -- niveles superados seguidos sin perder vidas
  best_safe_streak  int not null default 0,
  wins_duo          int not null default 0, -- victorias a 2 (en partidas de featMinLevels niveles o más)
  wins_full_team    int not null default 0, -- victorias a 4 (ídem)
  wins_no_vistazo   int not null default 0, -- victorias sin usar ningún vistazo (ídem)
  flawless_wins     int not null default 0, -- victorias sin perder ninguna vida (ídem)
  hard_wins         int not null default 0, -- victorias en dificultad Difícil
  long_wins         int not null default 0, -- victorias en partidas de 12 niveles
  best_group_wins   int not null default 0, -- más victorias con un mismo grupo de jugadores
  early_games       int not null default 0, -- partidas terminadas de madrugada
  updated_at        timestamptz not null default now()
);

-- Victorias con cada grupo exacto de jugadores (clave: sus ids ordenados).
create table if not exists public.player_group_wins (
  user_id   uuid not null references auth.users (id) on delete cascade,
  group_key text not null,
  wins      int not null default 0,
  primary key (user_id, group_key)
);

create table if not exists public.player_achievements (
  user_id        uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null references public.achievements (id),
  coins          int not null default 0,
  unlocked_at    timestamptz not null default now(),
  seen_at        timestamptz,
  primary key (user_id, achievement_id)
);

create table if not exists public.progress_events (
  user_id    uuid not null references auth.users (id) on delete cascade,
  event      text not null check (event in ('level', 'match')),
  ref        text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event, ref)
);

-- ───────────────────────────── Cuentas ─────────────────────────────
-- Todos empiezan como invitados (sesión anónima, guardada solo en ese navegador). Al iniciar
-- sesión con Google, el progreso de invitado de ese móvil se une a la cuenta:
--   1. Como invitado, la app pide un vale de un solo uso (start_account_merge) y lo guarda.
--   2. Vuelve de Google ya con la cuenta y lo canjea (claim_account_merge): monedas, cartas,
--      títulos, logros, estadísticas e historial pasan del invitado a la cuenta.
-- El vale solo sirve una vez, durante una hora, a una cuenta con sesión (no a otro invitado)
-- y solo si quien lo pidió sigue siendo invitado. Nadie puede canjear el progreso de otro sin
-- tener su vale, que nunca sale de su navegador.
create table if not exists public.account_merges (
  token      text primary key,
  from_user  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_by    uuid,
  used_at    timestamptz
);

-- ───────────────────────────── Amigos ─────────────────────────────
-- Cada jugador tiene un código de amigo. Con él se manda una solicitud (o desde una sala, a quien
-- esté contigo) y, al aceptarla, se puede invitar directamente a una sala. Nadie puede buscar
-- jugadores: solo se llega a alguien con su código o habiendo coincidido en una sala.
--   * player_public: lo que ven tus amigos (alias y cuándo estuviste conectado).
--   * friendships: dos filas por amistad (una en cada sentido), para consultar siempre igual.
--   * room_invites: caducan a los 2 minutos; no llevan el código de la sala.
--   * player_signals: como room_signals, pero por jugador. Solo dice «algo ha cambiado» y la app
--     pide entonces su lista con get_friends. Es lo único de esta parte que lee la app directamente.
create table if not exists public.player_public (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  friend_code  text not null unique,
  name         text not null default 'Jugador',
  last_seen_at timestamptz not null default now()
);

create table if not exists public.friendships (
  user_id    uuid not null references auth.users (id) on delete cascade,
  friend_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index if not exists friendships_friend_idx on public.friendships (friend_id);

create table if not exists public.friend_requests (
  from_user  uuid not null references auth.users (id) on delete cascade,
  to_user    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user),
  check (from_user <> to_user)
);
create index if not exists friend_requests_to_idx on public.friend_requests (to_user);

create table if not exists public.room_invites (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  from_user  uuid not null references auth.users (id) on delete cascade,
  to_user    uuid not null references auth.users (id) on delete cascade,
  from_name  text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (room_id, to_user)
);
create index if not exists room_invites_to_idx on public.room_invites (to_user);

create table if not exists public.player_signals (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  version    bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Catálogo de logros. Para cambiar un texto, un objetivo o un premio: aquí, y volver a ejecutar.
insert into public.achievements (id, category, name, description, condition, metric, target, reward_coins, sort) values
  ('games_1', 'games', 'Primera conexión', 'Toda gran aventura empieza con una partida.', 'Termina tu primera partida online', 'games', 1, 5, 10),
  ('games_15', 'games', 'Ya eres de la casa', 'Parece que esto empieza a gustarte.', 'Termina 15 partidas online', 'games', 15, 15, 11),
  ('games_50', 'games', 'Adicto a las cartas', 'Una partida más nunca hace daño.', 'Termina 50 partidas online', 'games', 50, 30, 12),
  ('games_100', 'games', 'Veterano', 'Ya conoces cada rincón de este juego.', 'Termina 100 partidas online', 'games', 100, 50, 13),
  ('wins_1', 'wins', 'Primera victoria', 'El primer «¡lo conseguimos!» nunca se olvida.', 'Gana una partida', 'wins', 1, 10, 20),
  ('wins_10', 'wins', 'Coleccionista de victorias', 'Ganar ya no es casualidad.', 'Gana 10 partidas', 'wins', 10, 25, 21),
  ('wins_25', 'wins', 'Imparable', 'Cuando os ponéis, no hay quien os pare.', 'Gana 25 partidas', 'wins', 25, 50, 22),
  ('wins_50', 'wins', 'Máquina de ganar', 'Medio centenar de victorias. Casi da miedo.', 'Gana 50 partidas', 'wins', 50, 100, 23),
  ('win_streak_3', 'wins', 'En racha', 'Una, dos y tres. ¿Quién os para?', 'Gana 3 partidas seguidas (una derrota corta la racha)', 'win_streak', 3, 20, 24),
  ('levels_10', 'progress', 'Paso a paso', 'Cada nivel es un escalón más.', 'Supera 10 niveles en total', 'levels', 10, 5, 30),
  ('levels_50', 'progress', 'Mente en crecimiento', 'Tu intuición ya no es la del primer día.', 'Supera 50 niveles en total', 'levels', 50, 20, 31),
  ('levels_100', 'progress', 'Nivel tras nivel', 'Cien niveles a tus espaldas.', 'Supera 100 niveles en total', 'levels', 100, 35, 32),
  ('long_win', 'progress', 'Hasta el final', 'Doce niveles, de la primera carta a la última.', 'Gana una partida de 12 niveles', 'long_wins', 1, 15, 33),
  ('hard_win', 'progress', 'Mente extraordinaria', 'Una vida, sin vistazos y la ronda final a muerte súbita. Y aun así.', 'Gana una partida en dificultad Difícil', 'hard_wins', 1, 50, 34),
  ('safe_5', 'skill', 'Sin margen de error', 'Ni una vida perdida en cinco niveles.', 'Supera 5 niveles seguidos sin perder ninguna vida', 'safe_streak', 5, 15, 40),
  ('clean_10', 'skill', 'Precisión absoluta', 'Diez niveles seguidos sin un solo error. Ni siquiera con escudo.', 'Supera 10 niveles seguidos sin ningún error', 'clean_streak', 10, 30, 41),
  ('no_vistazo_win', 'skill', 'Pulso de acero', 'Sin mirar las cartas de nadie. Pura intuición.', 'Gana una partida de 5 niveles o más sin usar ningún vistazo', 'wins_no_vistazo', 1, 20, 42),
  ('flawless_win', 'skill', 'Intuición perfecta', 'Todas las vidas intactas de principio a fin.', 'Gana una partida de 5 niveles o más sin perder ninguna vida', 'flawless_wins', 1, 30, 43),
  ('duo_win', 'team', 'Dos mentes, una', 'Solo vosotros dos, en perfecta sintonía.', 'Gana una partida de 5 niveles o más con 2 jugadores', 'wins_duo', 1, 10, 50),
  ('full_team_win', 'team', 'El equipo completo', 'Cuatro cabezas, un solo ritmo.', 'Gana una partida de 5 niveles o más con 4 jugadores', 'wins_full_team', 1, 20, 51),
  ('group_5', 'team', 'Unidos hasta el final', 'Este grupo ya no necesita palabras.', 'Gana 5 partidas con exactamente el mismo grupo de jugadores', 'group_wins', 5, 30, 52),
  ('team_levels_25', 'team', 'Sincronización', 'Ponerse de acuerdo entre muchos tiene su mérito.', 'Supera 25 niveles en partidas de 3 o 4 jugadores', 'team_levels', 25, 20, 53),
  ('early_bird', 'special', 'Madrugador', 'Mientras otros duermen, tú juegas.', 'Termina una partida entre las 6:00 y las 9:00 (hora de España)', 'early_games', 1, 10, 60),
  ('collector_5', 'special', 'Coleccionista', 'Un diseño para cada ocasión.', 'Consigue 5 diseños de cartas (sin contar el Clásico)', 'designs', 5, 25, 61),
  ('achievements_20', 'special', 'La mente definitiva', 'Lo has visto todo. O casi.', 'Consigue 20 logros', 'achievements', 20, 100, 62)
on conflict (id) do update
  set category = excluded.category, name = excluded.name, description = excluded.description,
      condition = excluded.condition, metric = excluded.metric, target = excluded.target,
      reward_coins = excluded.reward_coins, sort = excluded.sort;

-- Cartas exclusivas: solo se consiguen con estos logros.
insert into public.achievement_cosmetics (achievement_id, cosmetic_id) values
  ('games_15', 'obsidian'),
  ('wins_10', 'aurora'),
  ('clean_10', 'chrono'),
  ('wins_25', 'phoenix'),
  ('achievements_20', 'transcendence')
on conflict do nothing;

-- Al crear las estadísticas se rellenan con las partidas que ya estaban en el historial, para no
-- empezar de cero. Solo para quien aún no tiene fila: volver a ejecutar no suma nada.
insert into public.player_stats (user_id, games_completed, wins, levels_completed)
select u.uid,
       count(*) filter (where g.result in ('won', 'lost')),
       count(*) filter (where g.result = 'won'),
       coalesce(sum(case when g.result = 'won' then g.max_level
                         when g.result = 'lost' then greatest(g.level - 1, 0) else 0 end), 0)
from public.game_results g
cross join lateral unnest(g.player_ids) as u (uid)
where exists (select 1 from auth.users au where au.id = u.uid)
group by u.uid
on conflict (user_id) do nothing;

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

-- Economía: nadie escribe desde la app. Cada uno solo puede LEER lo suyo; el catálogo, todos.
alter table public.cosmetics         enable row level security;
alter table public.player_wallets    enable row level security;
alter table public.player_cosmetics  enable row level security;
alter table public.player_equipped   enable row level security;
alter table public.coin_transactions enable row level security;
alter table public.match_rewards     enable row level security;
revoke all on table public.cosmetics, public.player_wallets, public.player_cosmetics, public.player_equipped,
  public.coin_transactions, public.match_rewards
  from anon, authenticated, public;
grant select on table public.cosmetics, public.player_wallets, public.player_cosmetics, public.player_equipped,
  public.coin_transactions, public.match_rewards to authenticated;

drop policy if exists cosmetics_select_all on public.cosmetics;
create policy cosmetics_select_all on public.cosmetics for select to authenticated using (true);
drop policy if exists wallets_select_own on public.player_wallets;
create policy wallets_select_own on public.player_wallets
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists player_cosmetics_select_own on public.player_cosmetics;
create policy player_cosmetics_select_own on public.player_cosmetics
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists player_equipped_select_own on public.player_equipped;
create policy player_equipped_select_own on public.player_equipped
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists coin_transactions_select_own on public.coin_transactions;
create policy coin_transactions_select_own on public.coin_transactions
  for select to authenticated using (user_id = (select auth.uid()));
-- Logros: igual que la economía. Catálogos para todos; progreso y conseguidos, solo lo propio.
-- progress_events y player_group_wins son internos (sin acceso desde la app).
alter table public.achievements          enable row level security;
alter table public.achievement_cosmetics enable row level security;
alter table public.player_stats          enable row level security;
alter table public.player_group_wins     enable row level security;
alter table public.player_achievements   enable row level security;
alter table public.progress_events       enable row level security;
revoke all on table public.achievements, public.achievement_cosmetics, public.player_stats,
  public.player_group_wins, public.player_achievements, public.progress_events
  from public, anon, authenticated;
grant select on table public.achievements, public.achievement_cosmetics, public.player_stats,
  public.player_achievements to authenticated;

drop policy if exists achievements_select_all on public.achievements;
create policy achievements_select_all on public.achievements for select to authenticated using (true);
drop policy if exists achievement_cosmetics_select_all on public.achievement_cosmetics;
create policy achievement_cosmetics_select_all on public.achievement_cosmetics for select to authenticated using (true);
drop policy if exists player_stats_select_own on public.player_stats;
create policy player_stats_select_own on public.player_stats
  for select to authenticated using (user_id = (select auth.uid()));
-- Los vales para unir cuentas son internos (solo las funciones los leen).
alter table public.account_merges enable row level security;
revoke all on table public.account_merges from public, anon, authenticated;

-- Amigos: todo pasa por funciones. Solo se lee la señal propia (para el tiempo real).
alter table public.player_public   enable row level security;
alter table public.friendships     enable row level security;
alter table public.friend_requests enable row level security;
alter table public.room_invites    enable row level security;
alter table public.player_signals  enable row level security;
revoke all on table public.player_public, public.friendships, public.friend_requests, public.room_invites,
  public.player_signals
  from public, anon, authenticated;
grant select on table public.player_signals to authenticated;

drop policy if exists player_signals_select_own on public.player_signals;
create policy player_signals_select_own on public.player_signals
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists player_achievements_select_own on public.player_achievements;
create policy player_achievements_select_own on public.player_achievements
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists match_rewards_select_own on public.match_rewards;
create policy match_rewards_select_own on public.match_rewards
  for select to authenticated using (user_id = (select auth.uid()));

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

-- Dificultad difícil: la mitad de premios y más espaciados (3 ★, 6 ♥, 9 ★).
create or replace function game_private.hard_rewards()
returns jsonb language sql immutable set search_path = ''
as $body$
  select '[{"level":3,"lives":0,"shurikens":1},{"level":6,"lives":1,"shurikens":0},
           {"level":9,"lives":0,"shurikens":1}]'::jsonb;
$body$;

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
    'order',           game_private.jenum(p, 'order', array['asc', 'desc'], 'asc'),
    'mode',            game_private.jenum(p, 'mode', array['concentration', 'friends'], 'concentration'),
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
    v_lives := 1; v_sh := 0; -- difícil: una sola vida y ningún shuriken
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
           when 'classic' then
             case when p_config ->> 'difficulty' = 'hard' then game_private.hard_rewards()
                  else game_private.classic_rewards() end
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
-- En la ronda final, además: la mesa solo envía la última carta durante 3 s (las demás quedan
-- boca abajo) y no se sabe cuántas cartas le quedan a cada compañero.
create or replace function game_private.snapshot(p_room uuid, p_uid uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'serverTime', now(),
    'me', p_uid,
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'status', r.status, 'hostId', r.host_id, 'config', r.config,
      'gameNo', r.game_no, 'level', r.level, 'maxLevel', r.max_level, 'lives', r.lives,
      'shurikens', r.shurikens, 'rewinds', r.rewinds, 'shields', r.shields, 'shieldActive', r.shield_active,
      'offer', r.offer, 'lightningLevel', r.lightning_level, 'lightningEndsAt', r.lightning_ends_at,
      'pileAt', r.pile_at, 'pileHidden', jsonb_array_length(r.pile) - jsonb_array_length(v.pile),
      'version', r.version, 'shurikenBlocked', r.shuriken_blocked),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.user_id, 'name', p.name, 'seat', p.seat, 'ready', p.ready,
               'lastSeenAt', p.last_seen_at,
               'cardDesign', p.card_design,
               -- Título equipado (al momento: si lo cambia, los demás lo ven en la sala de espera).
               'title', (select jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity)
                           from public.player_equipped e join public.cosmetics c on c.id = e.cosmetic_id
                          where e.user_id = p.user_id and e.kind = 'title'),
               'cardsLeft', case when v.blind and p.user_id <> p_uid then null else
                 (select count(*) from public.hands h where h.room_id = p.room_id and h.user_id = p.user_id) end
             ) order by p.seat), '[]'::jsonb)
      from public.room_players p where p.room_id = r.id),
    'pile', v.pile,
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
    -- Al terminar: las monedas que ha recibido este jugador (null si no ha participado).
    'myReward', case when r.status in ('won', 'lost', 'abandoned') then (
      select jsonb_build_object('coins', mr.coins, 'breakdown', mr.breakdown,
                                'balanceBefore', mr.balance_before, 'balanceAfter', mr.balance_after)
      from public.game_results g join public.match_rewards mr on mr.match_id = g.id
      where g.room_id = r.id and g.game_no = r.game_no and mr.user_id = p_uid) end,
    'myHand', (
      -- En el orden en que se juegan (de menor a mayor, o de mayor a menor en descendente).
      select coalesce(jsonb_agg(h.card order by case when r.config ->> 'order' = 'desc' then -h.card else h.card end), '[]'::jsonb)
      from public.hands h where h.room_id = r.id and h.user_id = p_uid)
  )
  from public.rooms r
  cross join lateral (select r.status = 'playing' and r.level >= 1 and r.level = r.max_level as blind) f
  cross join lateral (
    select f.blind,
           case when not f.blind then r.pile
                when r.pile_at > now() - interval '3 seconds' and jsonb_array_length(r.pile) > 0
                  then jsonb_build_array(r.pile -> -1)
                else '[]'::jsonb end as pile
  ) v
  where r.id = p_room;
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
  -- El escudo solo dura el nivel en que se activa. Si es la ronda relámpago, el reloj empieza a
  -- contar tras el aviso y la cuenta atrás (6 s): 60 s en el nivel 1, +3 s por nivel, hasta 90 s.
  update public.rooms set pile = '[]'::jsonb, pile_at = null, revealed = '[]'::jsonb, vote = null, offer = null, last_reward = null,
                          shield_active = false, shuriken_blocked = '[]'::jsonb,
                          level_mistakes = 0, level_lives_lost = 0,
                          lightning_ends_at = case when level = lightning_level
                                                   then now() + make_interval(secs => 6 + least(90, 57 + 3 * level))
                                              end
   where id = p_room;
  update public.room_players set ready = false where room_id = p_room;
end;
$$;

create or replace function game_private.end_game(p_room uuid, p_status text)
returns void language plpgsql set search_path = ''
as $$
declare
  r public.rooms;
  v_prev text;
  v_match bigint;
begin
  select status into v_prev from public.rooms where id = p_room;
  update public.rooms set status = p_status, vote = null, offer = null, lightning_ends_at = null
   where id = p_room returning * into r;
  delete from public.hands where room_id = p_room;
  perform game_private.emit(p_room, p_status, null, jsonb_build_object('level', r.level));
  insert into public.game_results (room_id, game_no, result, level, max_level, player_ids, player_names)
  select r.id, r.game_no, p_status, r.level, r.max_level,
         coalesce(array_agg(p.user_id order by p.seat), '{}'),
         coalesce(array_agg(p.name order by p.seat), '{}')
  from public.room_players p where p.room_id = p_room
  returning id into v_match;
  -- Monedas por el resultado definitivo (en esta misma transacción: o todo o nada).
  -- Niveles superados: todos si se gana; si no, los anteriores al actual (o también el actual,
  -- si la partida se abandonó en la pantalla de «nivel superado»).
  perform game_private.grant_match_rewards(
    v_match, p_room,
    case when p_status = 'won' then r.max_level when v_prev = 'level_complete' then r.level else r.level - 1 end,
    p_status = 'won');
  -- Estadísticas y logros (también en esta transacción). Una partida abandonada no cuenta.
  if p_status in ('won', 'lost') then
    perform game_private.record_match_progress(v_match, p_room, p_status = 'won');
  end if;
end;
$$;

-- Comodín elegido: se suma y se apunta en la recompensa del nivel.
create or replace function game_private.grant_comodin(p_room uuid, p_kind text, p_how text)
returns void language plpgsql set search_path = ''
as $$
declare
  v_field text := case p_kind when 'shuriken' then 'shurikens' when 'rewind' then 'rewinds' else 'shields' end;
begin
  update public.rooms
     set shurikens = shurikens + (p_kind = 'shuriken')::int,
         rewinds = rewinds + (p_kind = 'rewind')::int,
         shields = shields + (p_kind = 'shield')::int,
         last_reward = case when last_reward is null then null
                            else jsonb_set(last_reward, array[v_field], to_jsonb(coalesce((last_reward ->> v_field)::int, 0) + 1)) end
   where id = p_room;
  perform game_private.emit(p_room, 'comodin_chosen', null, jsonb_build_object('kind', p_kind, 'how', p_how));
end;
$$;

-- Prepara la elección: 2 de los 3 comodines al azar, sin los que ya están al máximo.
-- Si solo queda uno posible se da directamente; si ninguno, el premio se pierde.
create or replace function game_private.make_offer(p_room uuid, p_left int)
returns void language plpgsql set search_path = ''
as $$
declare
  v_left int := p_left;
  v_open text[];
  r public.rooms;
begin
  update public.rooms set offer = null where id = p_room;
  while v_left > 0 loop
    select * into r from public.rooms where id = p_room;
    select coalesce(array_agg(k order by ord), '{}') into v_open
      from unnest(array['shuriken', 'rewind', 'shield']) with ordinality as t (k, ord)
     where case k when 'shuriken' then r.shurikens when 'rewind' then r.rewinds else r.shields end < r.shurikens_cap;
    if cardinality(v_open) = 0 then return; end if;
    if cardinality(v_open) = 1 then
      perform game_private.grant_comodin(p_room, v_open[1], 'auto');
      v_left := v_left - 1;
      continue;
    end if;
    update public.rooms
       set offer = jsonb_build_object(
             'choices', (select jsonb_agg(x.k) from (select k from unnest(v_open) as k order by random() limit 2) x),
             'left', v_left,
             'votes', '{}'::jsonb)
     where id = p_room;
    return;
  end loop;
end;
$$;

-- Gana el comodín más votado (empate o sin votos: al azar entre los empatados).
create or replace function game_private.resolve_offer(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  v_offer jsonb;
  v_kind text;
  v_top int;
begin
  select offer into v_offer from public.rooms where id = p_room;
  if v_offer is null then return; end if;
  with tally as (
    select c.k, (select count(*) from jsonb_each_text(v_offer -> 'votes') v where v.value = c.k) as n
    from jsonb_array_elements_text(v_offer -> 'choices') as c (k)
  ),
  top as (select k from tally where n = (select max(n) from tally))
  select (select k from top order by random() limit 1), (select count(*) from top) into v_kind, v_top;
  perform game_private.grant_comodin(p_room, v_kind, case when v_top > 1 then 'tie' else 'vote' end);
  perform game_private.make_offer(p_room, (v_offer ->> 'left')::int - 1);
end;
$$;

-- ¿Han votado todos qué comodín elegir?
create or replace function game_private.all_picked(p_room uuid)
returns boolean language sql stable set search_path = ''
as $$
  select r.offer is not null and not exists (
    select 1 from public.room_players p
    where p.room_id = p_room and not ((r.offer -> 'votes') ? p.user_id::text))
  from public.rooms r where r.id = p_room;
$$;

create or replace function game_private.check_level_end(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  r public.rooms;
  v_reward jsonb;
  v_lives int;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' then return; end if;
  if exists (select 1 from public.hands where room_id = p_room) then return; end if;
  -- Nivel superado: cuenta para las estadísticas y los logros de quienes siguen en la sala.
  perform game_private.record_level_done(p_room);
  if r.level >= r.max_level then
    perform game_private.end_game(p_room, 'won');
    return;
  end if;
  v_reward := game_private.reward_for(r.config, r.level);
  -- Si el siguiente nivel es la ronda final (sin comodines), los comodines no se reparten.
  if r.level + 1 = r.max_level then v_reward := v_reward || '{"shurikens":0}'::jsonb; end if;
  v_lives := least(r.lives + (v_reward ->> 'lives')::int, greatest(r.lives_cap, r.lives));
  update public.rooms
     set lives = v_lives, status = 'level_complete', vote = null, shield_active = false, lightning_ends_at = null,
         last_reward = jsonb_build_object('level', r.level, 'lives', v_lives - r.lives,
                                          'shurikens', 0, 'rewinds', 0, 'shields', 0)
   where id = p_room;
  update public.room_players set ready = false where room_id = p_room;
  perform game_private.emit(p_room, 'level_complete', null, jsonb_build_object(
    'level', r.level,
    'reward', jsonb_build_object('lives', v_lives - r.lives, 'comodines', (v_reward ->> 'shurikens')::int)));
  -- «shurikens» en la tabla de recompensas = comodines a elegir.
  perform game_private.make_offer(p_room, (v_reward ->> 'shurikens')::int);
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
  if exists (select 1 from public.rooms where id = p_room and status = 'level_complete' and offer is null)
     and exists (select 1 from public.room_players where room_id = p_room)
     and not exists (select 1 from public.room_players where room_id = p_room and not ready) then
    perform game_private.start_next_level(p_room);
  end if;
end;
$$;

-- Cancela la votación y apunta a quien la propuso: no podrá repetirla hasta que se juegue una carta.
drop function if exists game_private.cancel_vote_blocking(uuid);

-- Cancela la votación en curso. Quien la propuso no podrá proponer otro comodín hasta que se
-- juegue una carta (salvo si se canceló porque alguien salió). Si era Rebobinar, la vida no se
-- recupera: sin vidas se pierde la partida; si no, el nivel sigue (o termina si no hay cartas).
create or replace function game_private.cancel_vote(p_room uuid, p_actor uuid, p_reason text)
returns void language plpgsql set search_path = ''
as $$
declare
  v_vote jsonb;
  v_kind text;
  v_lives int;
begin
  select vote, lives into v_vote, v_lives from public.rooms where id = p_room;
  if v_vote is null then return; end if;
  v_kind := coalesce(v_vote ->> 'kind', 'shuriken');
  update public.rooms
     set shuriken_blocked = case
           when p_reason = 'player_left' or (v_vote ->> 'proposer') is null
                or shuriken_blocked ? (v_vote ->> 'proposer') then shuriken_blocked
           else shuriken_blocked || jsonb_build_array(v_vote ->> 'proposer')
         end,
         vote = null
   where id = p_room;
  perform game_private.emit(p_room, 'shuriken_cancelled', p_actor, jsonb_build_object('reason', p_reason, 'kind', v_kind));
  if v_kind = 'rewind' then
    if v_lives <= 0 then
      perform game_private.end_game(p_room, 'lost');
    else
      perform game_private.check_level_end(p_room);
    end if;
  end if;
end;
$$;

-- Aplica los plazos vencidos. Devuelve true si ha cambiado algo.
-- · Ronda relámpago sin terminar a tiempo: se pierden todas las vidas y la partida
--   (aunque hubiera una votación en curso, incluida la de Rebobinar).
-- · Votación caducada: se cancela.
create or replace function game_private.expire_if_due(p_room uuid)
returns boolean language plpgsql set search_path = ''
as $$
declare v_level int;
begin
  update public.rooms set lives = 0
   where id = p_room and status = 'playing' and lightning_ends_at is not null and lightning_ends_at <= now()
  returning level into v_level;
  if found then
    perform game_private.emit(p_room, 'lightning_timeout', null, jsonb_build_object('level', v_level));
    perform game_private.end_game(p_room, 'lost');
    return true;
  end if;
  if exists (select 1 from public.rooms
             where id = p_room and vote is not null and (vote ->> 'expiresAt')::timestamptz <= now()) then
    perform game_private.cancel_vote(p_room, null, 'expired');
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
  v_desc boolean;
  v_discarded jsonb;
begin
  select (config ->> 'order') = 'desc' into v_desc from public.rooms where id = p_room;

  with lowest as (
    select distinct on (h.user_id) h.user_id, h.card, p.seat
    from public.hands h
    join public.room_players p on p.room_id = h.room_id and p.user_id = h.user_id
    where h.room_id = p_room
    order by h.user_id, case when v_desc then -h.card else h.card end -- la que toca a cada uno
  ),
  removed as (
    delete from public.hands h using lowest l
    where h.room_id = p_room and h.card = l.card
    returning h.card
  )
  select coalesce(jsonb_agg(jsonb_build_object('p', l.user_id, 'c', l.card) order by l.seat), '[]'::jsonb)
    into v_discarded
  from lowest l;

  -- Las cartas descartadas se muestran siempre a todos.
  update public.rooms
     set revealed = revealed || (
       select coalesce(jsonb_agg(jsonb_build_object('c', e -> 'c', 'p', e -> 'p', 'r', 'shuriken') order by ord), '[]'::jsonb)
       from jsonb_array_elements(v_discarded) with ordinality as t (e, ord))
   where id = p_room;
  update public.rooms set shurikens = shurikens - 1, game_shurikens_used = game_shurikens_used + 1,
                          vote = null, shuriken_blocked = '[]'::jsonb
   where id = p_room;
  perform game_private.emit(p_room, 'shuriken_used', null, jsonb_build_object('discarded', v_discarded));
  perform game_private.check_level_end(p_room);
end;
$$;

-- Todos han aceptado: se aplica el comodín votado.
create or replace function game_private.execute_vote(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  v_kind text;
  v_lives int;
begin
  select coalesce(vote ->> 'kind', 'shuriken') into v_kind from public.rooms where id = p_room;
  if v_kind = 'shuriken' then
    perform game_private.execute_shuriken(p_room);
  elsif v_kind = 'shield' then
    update public.rooms set shields = shields - 1, shield_active = true, vote = null, shuriken_blocked = '[]'::jsonb
     where id = p_room;
    perform game_private.emit(p_room, 'shield_used', null, '{}'::jsonb);
  else
    update public.rooms set rewinds = rewinds - 1, lives = lives + 1, vote = null where id = p_room
    returning lives into v_lives;
    perform game_private.emit(p_room, 'rewind_used', null, jsonb_build_object('lives', v_lives));
    perform game_private.check_level_end(p_room);
  end if;
end;
$$;

-- Propone usar un vistazo ('shuriken') o un escudo. Lo tienen que aceptar todos.
create or replace function game_private.propose(p_room uuid, p_uid uuid, p_kind text)
returns void language plpgsql set search_path = ''
as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
  perform game_private.expire_if_due(p_room);
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
  if r.vote is not null then raise exception 'VOTE_IN_PROGRESS'; end if;
  -- Ronda final: sin comodines.
  if r.level = r.max_level then raise exception 'FINAL_ROUND'; end if;
  if p_kind = 'shuriken' and r.shurikens <= 0 then raise exception 'NO_SHURIKENS'; end if;
  if p_kind = 'shield' and r.shields <= 0 then raise exception 'NO_SHIELDS'; end if;
  if p_kind = 'shield' and r.shield_active then raise exception 'SHIELD_ACTIVE'; end if;
  if r.shuriken_blocked ? p_uid::text then raise exception 'SHURIKEN_BLOCKED'; end if;

  update public.rooms
     set vote = jsonb_build_object('kind', p_kind, 'proposer', p_uid, 'votes', jsonb_build_array(p_uid),
                                   'expiresAt', now() + interval '15 seconds')
   where id = p_room;
  perform game_private.emit(p_room, 'shuriken_proposed', p_uid, jsonb_build_object('kind', p_kind));
  if game_private.all_voted(p_room) then perform game_private.execute_vote(p_room); end if;
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
  update public.rooms set offer = offer #- array['votes', p_target::text] where id = p_room and offer is not null;
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
    perform game_private.cancel_vote(p_room, null, 'player_left');
    select * into r from public.rooms where id = p_room; -- cancelar Rebobinar puede terminar la partida
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
      if game_private.all_picked(p_room) then perform game_private.resolve_offer(p_room); end if;
      perform game_private.maybe_advance(p_room);
    end if;
  end if;
  return true;
end;
$$;

-- ───────────────────────────── Economía ─────────────────────────────

-- TODOS los números de las recompensas, en un único sitio. La idea: se cobra por el esfuerzo
-- real, y el esfuerzo de un nivel son sus cartas (jugadores × nivel).
--   * Por cada nivel superado: perLevel + 1 moneda por cada `cardsPerCoin` cartas del nivel.
--     (Los niveles altos valen más: tienen más cartas y son más difíciles.)
--   * Participación: si se supera al menos un nivel.
--   * Victoria: 1 moneda por cada `victoryCardsPerCoin` cartas de TODA la partida (crece mucho más
--     en las partidas largas: ganar una de 1 nivel apenas da nada).
--   * Para cobrar hay que haber jugado al menos `minCardsPlayed` cartas en la partida.
-- Ejemplos (victoria): 2 jugadores × 12 niveles = 131 · 3 × 10 = 139 · 4 × 8 = 118 · 2 × 3 = 14.
-- Y doce victorias de 1 nivel (2 jugadores) suman 60: mucho menos que UNA de 12 niveles.
create or replace function game_private.reward_settings()
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'perLevel', 1,
    'cardsPerCoin', 2,
    'participation', 2,
    'victoryCardsPerCoin', 4,
    'minCardsPlayed', 1);
$$;

-- Recompensa (con desglose) de una partida de p_players jugadores y p_max_level niveles en la
-- que se superaron p_completed niveles. Función pura: la usan las pruebas y grant_match_rewards.
create or replace function game_private.match_reward(p_players int, p_max_level int, p_completed int, p_won boolean)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  s jsonb := game_private.reward_settings();
  v_done int := greatest(0, least(coalesce(p_completed, 0), p_max_level));
  v_levels int := 0;
  v_part int := 0;
  v_win int := 0;
  l int;
begin
  for l in 1 .. v_done loop
    v_levels := v_levels + (s ->> 'perLevel')::int + ceil(p_players * l / (s ->> 'cardsPerCoin')::numeric)::int;
  end loop;
  if v_done >= 1 then v_part := (s ->> 'participation')::int; end if;
  if p_won then
    v_win := ceil((p_players * p_max_level * (p_max_level + 1) / 2) / (s ->> 'victoryCardsPerCoin')::numeric)::int;
  end if;
  return jsonb_build_object(
    'players', p_players, 'maxLevel', p_max_level, 'levelsCompleted', v_done, 'won', p_won,
    'participation', v_part, 'levels', v_levels, 'victory', v_win, 'total', v_part + v_levels + v_win);
end;
$$;

-- Crea (si no existen) el monedero del jugador, su diseño clásico y lo equipa.
create or replace function game_private.ensure_player(p_uid uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  insert into public.player_wallets (user_id) values (p_uid) on conflict do nothing;
  insert into public.player_cosmetics (user_id, cosmetic_id, source)
  select p_uid, c.id, 'default' from public.cosmetics c where c.unlock = 'default'
  on conflict do nothing;
  insert into public.player_equipped (user_id, kind, cosmetic_id) values (p_uid, 'card_design', 'classic')
  on conflict do nothing;
end;
$$;

-- ÚNICA forma de cambiar un saldo: suma (o resta) y apunta el movimiento. Si el saldo fuera a
-- quedar negativo, la restricción de la tabla aborta TODA la operación (compra incluida).
create or replace function game_private.add_coins(
  p_uid uuid, p_amount int, p_kind text, p_reason text, p_match bigint default null, p_cosmetic text default null)
returns int language plpgsql set search_path = ''
as $$
declare v_balance int;
begin
  update public.player_wallets set coins = coins + p_amount, updated_at = now()
   where user_id = p_uid returning coins into v_balance;
  if not found then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_amount <> 0 then
    insert into public.coin_transactions (user_id, amount, balance_after, kind, reason, match_id, cosmetic_id)
    values (p_uid, p_amount, v_balance, p_kind, p_reason, p_match, p_cosmetic);
  end if;
  return v_balance;
end;
$$;

-- Paga la recompensa de la partida p_match a quienes han participado de verdad: siguen en la sala
-- al terminar (quien abandona no cobra; quien se desconecta sin salir, sí) y han jugado alguna
-- carta. Una sola vez por jugador y partida (además, match_rewards lo impide con su clave única).
create or replace function game_private.grant_match_rewards(p_match bigint, p_room uuid, p_completed int, p_won boolean)
returns void language plpgsql set search_path = ''
as $$
declare
  r public.rooms;
  p record;
  v_players int;
  v_reward jsonb;
  v_before int;
  v_after int;
begin
  select * into r from public.rooms where id = p_room;
  v_players := coalesce(nullif(r.start_players, 0), (select count(*) from public.room_players where room_id = p_room));
  v_reward := game_private.match_reward(v_players, r.max_level, p_completed, p_won);
  for p in
    select user_id from public.room_players
     where room_id = p_room and cards_played >= (game_private.reward_settings() ->> 'minCardsPlayed')::int
     order by seat
  loop
    continue when exists (select 1 from public.match_rewards where match_id = p_match and user_id = p.user_id);
    perform game_private.ensure_player(p.user_id);
    select coins into v_before from public.player_wallets where user_id = p.user_id for update;
    v_after := game_private.add_coins(p.user_id, (v_reward ->> 'total')::int, 'match_reward',
      case when p_won then 'Victoria en partida' else 'Progreso de partida' end, p_match, null);
    insert into public.match_rewards (match_id, user_id, coins, breakdown, balance_before, balance_after)
    values (p_match, p.user_id, (v_reward ->> 'total')::int, v_reward, v_before, v_after);
  end loop;
end;
$$;

-- ───────────────────────────── Logros ─────────────────────────────

-- Los números de los logros, en un único sitio.
--   * featMinLevels: las hazañas de una partida (ganar a 2, a 4, sin vistazos, sin perder vidas)
--     solo cuentan en partidas de al menos estos niveles (ganar una de 1 nivel no es una hazaña).
--   * longGameLevels: niveles de la partida para «Hasta el final».
--   * earlyFrom / earlyTo / timeZone: franja de «Madrugador» (de earlyFrom:00 a earlyTo:00).
create or replace function game_private.achievement_settings()
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'featMinLevels', 5,
    'longGameLevels', 12,
    'earlyFrom', 6,
    'earlyTo', 9,
    'timeZone', 'Europe/Madrid');
$$;

-- Valor de una métrica para un jugador (lo que se compara con el objetivo de cada logro). Las
-- rachas usan el récord, para que conseguirlo una vez baste aunque luego se corte.
create or replace function game_private.metric_value(p_uid uuid, p_metric text)
returns int language sql stable set search_path = ''
as $$
  select case p_metric
    when 'games' then coalesce(s.games_completed, 0)
    when 'wins' then coalesce(s.wins, 0)
    when 'win_streak' then coalesce(s.best_win_streak, 0)
    when 'levels' then coalesce(s.levels_completed, 0)
    when 'team_levels' then coalesce(s.team_levels, 0)
    when 'clean_streak' then coalesce(s.best_clean_streak, 0)
    when 'safe_streak' then coalesce(s.best_safe_streak, 0)
    when 'wins_duo' then coalesce(s.wins_duo, 0)
    when 'wins_full_team' then coalesce(s.wins_full_team, 0)
    when 'wins_no_vistazo' then coalesce(s.wins_no_vistazo, 0)
    when 'flawless_wins' then coalesce(s.flawless_wins, 0)
    when 'hard_wins' then coalesce(s.hard_wins, 0)
    when 'long_wins' then coalesce(s.long_wins, 0)
    when 'group_wins' then coalesce(s.best_group_wins, 0)
    when 'early_games' then coalesce(s.early_games, 0)
    when 'designs' then (select count(*)::int from public.player_cosmetics pc
                           join public.cosmetics c on c.id = pc.cosmetic_id
                          where pc.user_id = p_uid and c.kind = 'card_design' and c.unlock <> 'default')
    when 'achievements' then (select count(*)::int from public.player_achievements where user_id = p_uid)
    else 0 end
  from (select 1) x
  left join public.player_stats s on s.user_id = p_uid;
$$;

-- Racha EN CURSO de las métricas de racha (para enseñar «llevas 6 de 10»); null en las demás.
create or replace function game_private.metric_current(p_uid uuid, p_metric text)
returns int language sql stable set search_path = ''
as $$
  select case p_metric
    when 'win_streak' then coalesce(s.win_streak, 0)
    when 'clean_streak' then coalesce(s.clean_streak, 0)
    when 'safe_streak' then coalesce(s.safe_streak, 0)
    end
  from (select 1) x
  left join public.player_stats s on s.user_id = p_uid;
$$;

-- Desbloquea los logros que ya se cumplen y entrega sus premios (monedas con add_coins, que lo
-- apunta; cosméticos al inventario con origen «achievement»). Cada logro, una sola vez (clave
-- primaria). Se repite mientras salga alguno nuevo: hay logros que cuentan logros o diseños.
create or replace function game_private.evaluate_achievements(p_uid uuid)
returns int language plpgsql set search_path = ''
as $$
declare
  a record;
  v_new int;
  v_total int := 0;
begin
  perform game_private.ensure_player(p_uid);
  loop
    v_new := 0;
    for a in
      select ach.* from public.achievements ach
       where ach.is_available
         and not exists (select 1 from public.player_achievements pa where pa.user_id = p_uid and pa.achievement_id = ach.id)
       order by ach.sort, ach.id
    loop
      continue when game_private.metric_value(p_uid, a.metric) < a.target;
      insert into public.player_achievements (user_id, achievement_id, coins)
      values (p_uid, a.id, a.reward_coins) on conflict do nothing;
      continue when not found;
      v_new := v_new + 1;
      if a.reward_coins > 0 then
        perform game_private.add_coins(p_uid, a.reward_coins, 'achievement', 'Logro: ' || a.name);
      end if;
      insert into public.player_cosmetics (user_id, cosmetic_id, source)
      select p_uid, ac.cosmetic_id, 'achievement' from public.achievement_cosmetics ac where ac.achievement_id = a.id
      on conflict do nothing;
    end loop;
    v_total := v_total + v_new;
    exit when v_new = 0;
  end loop;
  return v_total;
end;
$$;

-- Fila de estadísticas (y monedero) de un jugador, si aún no existe.
create or replace function game_private.ensure_stats(p_uid uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  perform game_private.ensure_player(p_uid);
  insert into public.player_stats (user_id) values (p_uid) on conflict do nothing;
end;
$$;

-- Nivel superado (se llama al vaciarse las manos, ANTES de pasar al siguiente o de ganar).
-- Suma para todos los que siguen en la sala, una sola vez por jugador, sala, partida y nivel.
create or replace function game_private.record_level_done(p_room uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  r public.rooms;
  p record;
  v_clean boolean;
  v_safe boolean;
begin
  select * into r from public.rooms where id = p_room;
  v_clean := r.level_mistakes = 0;
  v_safe := r.level_lives_lost = 0;
  for p in select user_id from public.room_players where room_id = p_room order by seat loop
    insert into public.progress_events (user_id, event, ref)
    values (p.user_id, 'level', r.id || ':' || r.game_no || ':' || r.level) on conflict do nothing;
    continue when not found;
    perform game_private.ensure_stats(p.user_id);
    update public.player_stats
       set levels_completed = levels_completed + 1,
           team_levels = team_levels + (r.start_players >= 3)::int,
           clean_streak = case when v_clean then clean_streak + 1 else 0 end,
           best_clean_streak = greatest(best_clean_streak, case when v_clean then clean_streak + 1 else 0 end),
           safe_streak = case when v_safe then safe_streak + 1 else 0 end,
           best_safe_streak = greatest(best_safe_streak, case when v_safe then safe_streak + 1 else 0 end),
           updated_at = now()
     where user_id = p.user_id;
    perform game_private.evaluate_achievements(p.user_id);
  end loop;
end;
$$;

-- Partida terminada (ganada o perdida). Cuenta para quien cobra monedas por ella: sigue en la
-- sala y ha jugado alguna carta. Si se pierde, además, se cortan las rachas de TODOS los que
-- siguen en la sala (hayan jugado o no). Una sola vez por jugador y partida (progress_events).
create or replace function game_private.record_match_progress(p_match bigint, p_room uuid, p_won boolean)
returns void language plpgsql set search_path = ''
as $$
declare
  s jsonb := game_private.achievement_settings();
  r public.rooms;
  p record;
  v_feat boolean;
  v_long boolean;
  v_hard boolean;
  v_early boolean;
  v_hour int;
  v_group text;
  v_group_wins int;
begin
  select * into r from public.rooms where id = p_room;
  v_feat := r.max_level >= (s ->> 'featMinLevels')::int;
  v_long := r.max_level >= (s ->> 'longGameLevels')::int;
  v_hard := r.config ->> 'difficulty' = 'hard';
  v_hour := extract(hour from now() at time zone (s ->> 'timeZone'))::int;
  v_early := v_hour >= (s ->> 'earlyFrom')::int and v_hour < (s ->> 'earlyTo')::int;
  select string_agg(user_id::text, ',' order by user_id) into v_group from public.room_players where room_id = p_room;
  for p in select user_id, cards_played from public.room_players where room_id = p_room order by seat loop
    insert into public.progress_events (user_id, event, ref) values (p.user_id, 'match', p_match::text)
    on conflict do nothing;
    continue when not found;
    perform game_private.ensure_stats(p.user_id);
    if p.cards_played < (game_private.reward_settings() ->> 'minCardsPlayed')::int then
      if not p_won then
        update public.player_stats set win_streak = 0, clean_streak = 0, safe_streak = 0, updated_at = now()
         where user_id = p.user_id;
      end if;
      continue;
    end if;
    v_group_wins := 0;
    if p_won then
      insert into public.player_group_wins (user_id, group_key, wins) values (p.user_id, v_group, 1)
      on conflict (user_id, group_key) do update set wins = public.player_group_wins.wins + 1
      returning wins into v_group_wins;
    end if;
    update public.player_stats
       set games_completed = games_completed + 1,
           wins = wins + p_won::int,
           win_streak = case when p_won then win_streak + 1 else 0 end,
           best_win_streak = greatest(best_win_streak, case when p_won then win_streak + 1 else 0 end),
           wins_duo = wins_duo + (p_won and v_feat and r.start_players = 2)::int,
           wins_full_team = wins_full_team + (p_won and v_feat and r.start_players = 4)::int,
           wins_no_vistazo = wins_no_vistazo + (p_won and v_feat and r.game_shurikens_used = 0)::int,
           flawless_wins = flawless_wins + (p_won and v_feat and r.game_lives_lost = 0)::int,
           hard_wins = hard_wins + (p_won and v_hard)::int,
           long_wins = long_wins + (p_won and v_long)::int,
           best_group_wins = greatest(best_group_wins, v_group_wins),
           early_games = early_games + v_early::int,
           -- Perder corta las rachas de niveles: el nivel en que se pierde no se ha superado.
           clean_streak = case when p_won then clean_streak else 0 end,
           safe_streak = case when p_won then safe_streak else 0 end,
           updated_at = now()
     where user_id = p.user_id;
    perform game_private.evaluate_achievements(p.user_id);
  end loop;
end;
$$;

-- Lo que la app necesita del jugador: saldo, lo equipado, lo que posee (y cómo lo consiguió), el
-- catálogo (a la venta, por logro y lo que ya posea aunque deje de estar disponible), sus
-- estadísticas, los logros con su progreso y los conseguidos que aún no se le han enseñado.
create or replace function game_private.profile(p_uid uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'coins', (select coins from public.player_wallets where user_id = p_uid),
    'equipped', coalesce((select jsonb_object_agg(kind, cosmetic_id) from public.player_equipped where user_id = p_uid), '{}'::jsonb),
    'owned', coalesce((select jsonb_agg(cosmetic_id order by acquired_at, cosmetic_id) from public.player_cosmetics where user_id = p_uid), '[]'::jsonb),
    'sources', coalesce((select jsonb_object_agg(cosmetic_id, source) from public.player_cosmetics where user_id = p_uid), '{}'::jsonb),
    'catalog', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'description', c.description,
                                          'price', c.price, 'unlock', c.unlock, 'rarity', c.rarity, 'available', c.is_available,
                                          'achievement', (select ac.achievement_id from public.achievement_cosmetics ac
                                                           where ac.cosmetic_id = c.id order by ac.achievement_id limit 1))
                       order by c.sort, c.id)
      from public.cosmetics c
      where c.is_available or exists (select 1 from public.player_cosmetics o where o.user_id = p_uid and o.cosmetic_id = c.id)
    ), '[]'::jsonb),
    'rewards', game_private.reward_settings(),
    'stats', (
      select jsonb_build_object(
        'games', coalesce(st.games_completed, 0), 'wins', coalesce(st.wins, 0),
        'levels', coalesce(st.levels_completed, 0), 'bestWinStreak', coalesce(st.best_win_streak, 0),
        'bestCleanStreak', coalesce(st.best_clean_streak, 0))
      from (select 1) x left join public.player_stats st on st.user_id = p_uid),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'category', a.category, 'name', a.name, 'description', a.description,
               'condition', a.condition, 'target', a.target,
               'progress', least(a.target, game_private.metric_value(p_uid, a.metric)),
               'streak', game_private.metric_current(p_uid, a.metric),
               'rewardCoins', a.reward_coins,
               'rewardCosmetics', coalesce((select jsonb_agg(ac.cosmetic_id order by ac.cosmetic_id)
                                             from public.achievement_cosmetics ac where ac.achievement_id = a.id), '[]'::jsonb),
               'unlockedAt', pa.unlocked_at, 'secret', a.is_secret)
             order by a.sort, a.id)
      from public.achievements a
      left join public.player_achievements pa on pa.achievement_id = a.id and pa.user_id = p_uid
      where a.is_available or pa.user_id is not null
    ), '[]'::jsonb),
    'unseen', coalesce((
      select jsonb_agg(pa.achievement_id order by pa.unlocked_at, a.sort)
      from public.player_achievements pa join public.achievements a on a.id = pa.achievement_id
      where pa.user_id = p_uid and pa.seen_at is null
    ), '[]'::jsonb));
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
  delete from public.room_invites where expires_at < now();
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
  -- En una sala no puede haber dos con el mismo nombre (mayúsculas aparte): la app pide otro.
  if exists (select 1 from public.room_players where room_id = r.id and lower(name) = lower(v_name)) then
    raise exception 'NAME_TAKEN';
  end if;

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
         rewinds = 0, shields = 0, shield_active = false, offer = null,
         game_shurikens_used = 0, game_lives_lost = 0,
         lives_cap = (v_res ->> 'livesCap')::int,
         shurikens_cap = (v_res ->> 'shurikensCap')::int,
         -- Ronda relámpago: un nivel al azar, nunca el último (sin ronda si solo hay uno).
         -- Se sortea antes de repartir: el reparto pone en marcha el reloj si toca en el nivel 1.
         lightning_level = case when (v_res ->> 'maxLevel')::int >= 2
                                then 1 + floor(random() * ((v_res ->> 'maxLevel')::int - 1))::int
                                else 0 end,
         start_players = v_count
   where id = p_room;
  -- Cada jugador juega la partida con el diseño de cartas que tenga equipado AHORA (si lo cambia
  -- durante la partida, se aplica en la siguiente) y empieza sin cartas jugadas.
  update public.room_players p
     set cards_played = 0,
         card_design = coalesce((select e.cosmetic_id from public.player_equipped e
                                  where e.user_id = p.user_id and e.kind = 'card_design'), 'classic')
   where p.room_id = p_room;
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
  v_desc boolean := (r.config ->> 'order') = 'desc'; -- orden descendente: de 100 a 1
  v_lowest int; -- la carta que toca: la más baja (o la más alta en descendente)
  v_lower jsonb;
  v_lives int;
  v_sudden boolean;
begin
  if p_action is not null then
    insert into public.processed_actions (user_id, action_id, room_id) values (v_uid, p_action, p_room)
    on conflict do nothing;
    if not found then return game_private.snapshot(p_room, v_uid); end if;
  end if;

  if r.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
  perform game_private.expire_if_due(p_room);
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
  if r.vote is not null then raise exception 'VOTE_IN_PROGRESS'; end if;

  select case when v_desc then max(card) else min(card) end into v_lowest
    from public.hands where room_id = p_room and user_id = v_uid;
  if v_lowest is null then raise exception 'NO_CARDS'; end if;
  if p_card is distinct from v_lowest then
    if exists (select 1 from public.hands where room_id = p_room and user_id = v_uid and card = p_card) then
      raise exception 'NOT_LOWEST';
    end if;
    raise exception 'NOT_IN_HAND';
  end if;

  delete from public.hands where room_id = p_room and card = p_card;
  update public.room_players set cards_played = cards_played + 1 where room_id = p_room and user_id = v_uid;
  -- Se ha jugado una carta: todos pueden volver a proponer shuriken.
  update public.rooms set pile = pile || jsonb_build_array(jsonb_build_object('c', p_card, 'p', v_uid)),
                          pile_at = now(), shuriken_blocked = '[]'::jsonb
   where id = p_room;

  -- ¿Alguien tenía cartas que debían ir antes (menores; mayores en descendente)?
  -- Error: se descartan TODAS y se pierde UNA vida (salvo que haya un escudo activo).
  -- En la ronda final en «Difícil» es muerte súbita: se pierden TODAS las vidas.
  with removed as (
    delete from public.hands
     where room_id = p_room and (case when v_desc then card > p_card else card < p_card end)
    returning card, user_id
  )
  select jsonb_agg(jsonb_build_object('c', card, 'p', user_id)
                   order by case when v_desc then -card else card end) into v_lower from removed;

  if v_lower is not null then
    update public.rooms
       set revealed = revealed || (
             select jsonb_agg(e || '{"r":"mistake"}'::jsonb order by ord)
             from jsonb_array_elements(v_lower) with ordinality as t (e, ord))
     where id = p_room;
    if r.shield_active then
      -- El escudo absorbe este error: se descartan las cartas, pero no se pierde vida.
      update public.rooms set shield_active = false, level_mistakes = level_mistakes + 1
       where id = p_room returning lives into v_lives;
      perform game_private.emit(p_room, 'mistake', v_uid,
        jsonb_build_object('card', p_card, 'discarded', v_lower, 'lives', v_lives, 'shielded', true));
    else
      v_sudden := r.level = r.max_level and r.config ->> 'difficulty' = 'hard';
      -- (En el SET, `lives` es el valor de antes: con muerte súbita se pierden todas esas.)
      update public.rooms set lives = case when v_sudden then 0 else lives - 1 end,
                              level_mistakes = level_mistakes + 1,
                              level_lives_lost = level_lives_lost + case when v_sudden then lives else 1 end,
                              game_lives_lost = game_lives_lost + case when v_sudden then lives else 1 end
       where id = p_room returning lives into v_lives;
      perform game_private.emit(p_room, 'mistake', v_uid,
        jsonb_build_object('card', p_card, 'discarded', v_lower, 'lives', v_lives)
        || case when v_sudden then '{"suddenDeath": true}'::jsonb else '{}'::jsonb end);
      if r.rewinds > 0 and r.level <> r.max_level then
        -- Se pregunta a todos si quieren usar Rebobinar (nunca en la ronda final). Hasta decidirlo,
        -- la partida espera (incluso si era la última vida o el nivel se ha quedado sin cartas).
        update public.rooms
           set vote = jsonb_build_object('kind', 'rewind', 'proposer', null, 'votes', '[]'::jsonb,
                                         'expiresAt', now() + interval '20 seconds')
         where id = p_room;
        perform game_private.emit(p_room, 'rewind_offered', null, jsonb_build_object('lives', v_lives));
        perform game_private.touch(p_room);
        return game_private.snapshot(p_room, v_uid);
      end if;
      if v_lives <= 0 then
        perform game_private.end_game(p_room, 'lost');
        perform game_private.touch(p_room);
        return game_private.snapshot(p_room, v_uid);
      end if;
    end if;
  else
    -- En la ronda final (mesa a ciegas) el aviso de jugada no lleva el número.
    perform game_private.emit(p_room, 'play', v_uid,
      case when r.level = r.max_level then '{}'::jsonb else jsonb_build_object('card', p_card) end);
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
  perform game_private.propose(p_room, v_uid, 'shuriken');
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

create or replace function public.propose_shield(p_room uuid, p_action uuid default null)
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
  perform game_private.propose(p_room, v_uid, 'shield');
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

-- Voto en la votación en curso (vistazo, escudo o rebobinar). Un «no» la cancela.
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
    perform game_private.cancel_vote(p_room, v_uid, 'rejected');
    perform game_private.touch(p_room);
    return game_private.snapshot(p_room, v_uid);
  end if;

  if (r.vote -> 'votes') ? v_uid::text then
    return game_private.snapshot(p_room, v_uid); -- voto repetido: sin efecto
  end if;
  update public.rooms
     set vote = jsonb_set(vote, '{votes}', (vote -> 'votes') || to_jsonb(v_uid::text))
   where id = p_room;
  if game_private.all_voted(p_room) then perform game_private.execute_vote(p_room); end if;
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

-- Aplica los plazos vencidos: votación caducada o tiempo agotado en la ronda relámpago.
-- (Lo piden los móviles cuando su reloj llega a cero.)
create or replace function public.expire_shuriken_vote(p_room uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if r.status = 'playing' and game_private.expire_if_due(p_room) then
    perform game_private.touch(p_room);
  end if;
  return game_private.snapshot(p_room, v_uid);
end;
$$;

-- Voto para elegir comodín tras superar el nivel p_level (se puede cambiar mientras falten votos).
-- Cuando han votado todos, gana el más votado; si hay empate, al azar.
create or replace function public.pick_comodin(p_room uuid, p_level int, p_kind text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
begin
  if r.status <> 'level_complete' or r.level <> p_level or r.offer is null then
    return game_private.snapshot(p_room, v_uid);
  end if;
  if not ((r.offer -> 'choices') ? coalesce(p_kind, '')) then raise exception 'INVALID_STATE'; end if;
  if (r.offer -> 'votes' ->> v_uid::text) = p_kind then return game_private.snapshot(p_room, v_uid); end if;
  update public.rooms set offer = jsonb_set(offer, array['votes', v_uid::text], to_jsonb(p_kind)) where id = p_room;
  if game_private.all_picked(p_room) then
    perform game_private.resolve_offer(p_room);
    perform game_private.maybe_advance(p_room);
  end if;
  perform game_private.touch(p_room);
  return game_private.snapshot(p_room, v_uid);
end;
$$;

-- p_level es el nivel recién superado: una petición repetida o tardía no tiene efecto.
-- Si el anfitrión fuerza el avance con una elección pendiente, se decide con los votos que haya.
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
    while exists (select 1 from public.rooms where id = p_room and offer is not null) loop
      perform game_private.resolve_offer(p_room);
    end loop;
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
         rewinds = 0, shields = 0, shield_active = false, offer = null, lightning_level = 0, lightning_ends_at = null,
         pile = '[]'::jsonb, pile_at = null, revealed = '[]'::jsonb, vote = null, last_reward = null, shuriken_blocked = '[]'::jsonb
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
  -- Sin números: ninguna cifra (7, ７, ①, Ⅶ, ½, ²…), que sería decir las cartas.
  if v_body ~ '[0-9０-９²³¹¼-¾⁰⁴-⁹₀-₉⅐-↉①-⒛⓪-⓿❶-➓٠-٩۰-۹]' then
    raise exception 'NO_NUMBERS';
  end if;
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

-- ── Economía (API) ── Ninguna recibe precios ni cantidades: todo sale de las tablas del servidor.

-- Perfil del jugador (lo crea la primera vez: saldo 0 y el diseño clásico equipado).
create or replace function public.get_my_profile()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  perform game_private.ensure_player(v_uid);
  -- Por si se ha añadido un logro nuevo que ya cumple (p. ej. con su historial).
  perform game_private.evaluate_achievements(v_uid);
  return game_private.profile(v_uid);
end;
$$;

-- Compra un cosmético con monedas. Todo o nada: se cobra, se apunta y se entrega, o no pasa nada.
-- El monedero se bloquea (FOR UPDATE): dos pulsaciones seguidas se atienden de una en una y la
-- segunda recibe ALREADY_OWNED en lugar de cobrar dos veces.
create or replace function public.buy_cosmetic(p_cosmetic text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_coins int;
  c public.cosmetics;
begin
  perform game_private.ensure_player(v_uid);
  select coins into v_coins from public.player_wallets where user_id = v_uid for update;
  select * into c from public.cosmetics where id = p_cosmetic;
  if not found then raise exception 'COSMETIC_NOT_FOUND'; end if;
  if exists (select 1 from public.player_cosmetics where user_id = v_uid and cosmetic_id = c.id) then
    raise exception 'ALREADY_OWNED';
  end if;
  if c.unlock <> 'coins' or not c.is_available or c.price is null then raise exception 'NOT_FOR_SALE'; end if;
  if v_coins < c.price then raise exception 'NOT_ENOUGH_COINS'; end if;
  insert into public.player_cosmetics (user_id, cosmetic_id, source) values (v_uid, c.id, 'purchase');
  perform game_private.add_coins(v_uid, -c.price, 'purchase', 'Compra: ' || c.name, null, c.id);
  -- Comprar diseños cuenta para «Coleccionista».
  perform game_private.evaluate_achievements(v_uid);
  return game_private.profile(v_uid);
end;
$$;

-- Equipa un cosmético que ya se posee (gratis y tantas veces como se quiera). Se aplica a las
-- partidas que empiecen a partir de ahora.
create or replace function public.equip_cosmetic(p_cosmetic text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_kind text;
begin
  perform game_private.ensure_player(v_uid);
  select kind into v_kind from public.cosmetics where id = p_cosmetic;
  if not found then raise exception 'COSMETIC_NOT_FOUND'; end if;
  if not exists (select 1 from public.player_cosmetics where user_id = v_uid and cosmetic_id = p_cosmetic) then
    raise exception 'NOT_OWNED';
  end if;
  insert into public.player_equipped (user_id, kind, cosmetic_id) values (v_uid, v_kind, p_cosmetic)
  on conflict (user_id, kind) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  return game_private.profile(v_uid);
end;
$$;

-- Quita el título (jugar sin título). El diseño de cartas no se puede quitar: se equipa otro
-- (el Clásico, por ejemplo).
create or replace function public.unequip_cosmetic(p_kind text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  perform game_private.ensure_player(v_uid);
  if p_kind is distinct from 'title' then raise exception 'CANNOT_UNEQUIP'; end if;
  delete from public.player_equipped where user_id = v_uid and kind = p_kind;
  return game_private.profile(v_uid);
end;
$$;

-- Marca como enseñados los logros conseguidos (la app ya ha mostrado su aviso).
create or replace function public.mark_achievements_seen(p_ids text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  update public.player_achievements set seen_at = now()
   where user_id = v_uid and achievement_id = any (coalesce(p_ids, '{}')) and seen_at is null;
  return game_private.profile(v_uid);
end;
$$;

-- ── Cuentas (API) ──

-- ¿Es un invitado (sesión anónima)? Quien no existe cuenta como invitado: nunca tiene cuenta.
create or replace function game_private.is_guest(p_uid uuid)
returns boolean language sql stable set search_path = ''
as $$
  select coalesce((select u.is_anonymous from auth.users u where u.id = p_uid), true);
$$;

-- Pasa TODO el progreso de p_from (invitado) a p_to (cuenta) y deja a p_from vacío, de modo que
-- no se pueda unir dos veces. Las monedas se suman; cartas, títulos y logros se juntan (si ya
-- estaban, se queda la fecha más antigua); las estadísticas se suman (los récords y rachas, el
-- mayor); el historial de partidas pasa a la cuenta. Lo equipado en la cuenta se respeta, salvo
-- que fuera lo de serie (entonces se usa lo que llevaba el invitado).
create or replace function game_private.merge_account(p_from uuid, p_to uuid)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_coins int;
  v_cards int;
  v_titles int;
  v_achievements int;
  f public.player_stats;
begin
  perform game_private.ensure_stats(p_to);

  select coins into v_coins from public.player_wallets where user_id = p_from for update;
  v_coins := coalesce(v_coins, 0);
  if v_coins > 0 then
    perform game_private.add_coins(p_from, -v_coins, 'adjustment', 'Pasadas a tu cuenta');
    perform game_private.add_coins(p_to, v_coins, 'adjustment', 'Progreso de invitado unido a tu cuenta');
  end if;

  select count(*) filter (where c.kind = 'card_design'), count(*) filter (where c.kind = 'title')
    into v_cards, v_titles
  from public.player_cosmetics o join public.cosmetics c on c.id = o.cosmetic_id
  where o.user_id = p_from and o.source <> 'default'
    and not exists (select 1 from public.player_cosmetics x where x.user_id = p_to and x.cosmetic_id = o.cosmetic_id);
  insert into public.player_cosmetics (user_id, cosmetic_id, source, acquired_at)
  select p_to, o.cosmetic_id, o.source, o.acquired_at from public.player_cosmetics o where o.user_id = p_from
  on conflict (user_id, cosmetic_id) do update
    set acquired_at = least(public.player_cosmetics.acquired_at, excluded.acquired_at);
  insert into public.player_equipped (user_id, kind, cosmetic_id)
  select p_to, e.kind, e.cosmetic_id from public.player_equipped e where e.user_id = p_from
  on conflict (user_id, kind) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now()
    where exists (select 1 from public.cosmetics c
                   where c.id = public.player_equipped.cosmetic_id and c.unlock = 'default');
  delete from public.player_cosmetics where user_id = p_from and source <> 'default';

  select count(*) into v_achievements from public.player_achievements a
  where a.user_id = p_from
    and not exists (select 1 from public.player_achievements b where b.user_id = p_to and b.achievement_id = a.achievement_id);
  -- Ya se enseñaron (o se enseñarán) en el móvil del invitado: no se repiten los avisos.
  insert into public.player_achievements (user_id, achievement_id, coins, unlocked_at, seen_at)
  select p_to, a.achievement_id, a.coins, a.unlocked_at, coalesce(a.seen_at, now())
  from public.player_achievements a where a.user_id = p_from
  on conflict (user_id, achievement_id) do update
    set unlocked_at = least(public.player_achievements.unlocked_at, excluded.unlocked_at);
  delete from public.player_achievements where user_id = p_from;

  select * into f from public.player_stats where user_id = p_from;
  if found then
    update public.player_stats t
       set games_completed = t.games_completed + f.games_completed,
           wins = t.wins + f.wins,
           win_streak = greatest(t.win_streak, f.win_streak),
           best_win_streak = greatest(t.best_win_streak, f.best_win_streak),
           levels_completed = t.levels_completed + f.levels_completed,
           team_levels = t.team_levels + f.team_levels,
           clean_streak = greatest(t.clean_streak, f.clean_streak),
           best_clean_streak = greatest(t.best_clean_streak, f.best_clean_streak),
           safe_streak = greatest(t.safe_streak, f.safe_streak),
           best_safe_streak = greatest(t.best_safe_streak, f.best_safe_streak),
           wins_duo = t.wins_duo + f.wins_duo,
           wins_full_team = t.wins_full_team + f.wins_full_team,
           wins_no_vistazo = t.wins_no_vistazo + f.wins_no_vistazo,
           flawless_wins = t.flawless_wins + f.flawless_wins,
           hard_wins = t.hard_wins + f.hard_wins,
           long_wins = t.long_wins + f.long_wins,
           early_games = t.early_games + f.early_games,
           updated_at = now()
     where t.user_id = p_to;
    delete from public.player_stats where user_id = p_from;
  end if;

  -- Los grupos se identifican por los ids de sus jugadores: el del invitado pasa a ser el de la cuenta.
  insert into public.player_group_wins (user_id, group_key, wins)
  select p_to,
         (select string_agg(x, ',' order by x::uuid)
            from unnest(string_to_array(replace(g.group_key, p_from::text, p_to::text), ',')) as x),
         g.wins
  from public.player_group_wins g where g.user_id = p_from
  on conflict (user_id, group_key) do update set wins = public.player_group_wins.wins + excluded.wins;
  delete from public.player_group_wins where user_id = p_from;
  update public.player_stats
     set best_group_wins = greatest(best_group_wins,
           coalesce((select max(wins) from public.player_group_wins where user_id = p_to), 0))
   where user_id = p_to;

  insert into public.progress_events (user_id, event, ref, created_at)
  select p_to, event, ref, created_at from public.progress_events where user_id = p_from
  on conflict do nothing;
  delete from public.progress_events where user_id = p_from;

  update public.game_results set player_ids = array_replace(player_ids, p_from, p_to)
   where p_from = any (player_ids);

  -- Amigos y solicitudes pasan a la cuenta. Si la cuenta aún no tenía código, se queda el del invitado.
  if not exists (select 1 from public.player_public where user_id = p_to) then
    update public.player_public set user_id = p_to where user_id = p_from;
  end if;
  delete from public.player_public where user_id = p_from;
  insert into public.friendships (user_id, friend_id, created_at)
  select p_to, friend_id, created_at from public.friendships where user_id = p_from and friend_id <> p_to
  on conflict do nothing;
  insert into public.friendships (user_id, friend_id, created_at)
  select user_id, p_to, created_at from public.friendships where friend_id = p_from and user_id <> p_to
  on conflict do nothing;
  delete from public.friendships where user_id = p_from or friend_id = p_from;
  insert into public.friend_requests (from_user, to_user, created_at)
  select p_to, to_user, created_at from public.friend_requests r
   where from_user = p_from and to_user <> p_to
     and not exists (select 1 from public.friendships fr where fr.user_id = p_to and fr.friend_id = r.to_user)
  on conflict do nothing;
  insert into public.friend_requests (from_user, to_user, created_at)
  select from_user, p_to, created_at from public.friend_requests r
   where to_user = p_from and from_user <> p_to
     and not exists (select 1 from public.friendships fr where fr.user_id = p_to and fr.friend_id = r.from_user)
  on conflict do nothing;
  delete from public.friend_requests where from_user = p_from or to_user = p_from;
  delete from public.room_invites where from_user = p_from or to_user = p_from;
  perform game_private.bump_signal(fr.friend_id) from public.friendships fr where fr.user_id = p_to;

  -- Con lo unido puede cumplir logros nuevos (p. ej. coleccionar 5 diseños).
  perform game_private.evaluate_achievements(p_to);

  return jsonb_build_object(
    'coins', v_coins, 'cards', v_cards, 'titles', v_titles, 'achievements', v_achievements,
    'games', coalesce(f.games_completed, 0));
end;
$$;

-- Paso 1 (como invitado, justo antes de ir a Google): un vale de un solo uso para su progreso.
create or replace function public.start_account_merge()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not game_private.is_guest(v_uid) then raise exception 'NOT_GUEST'; end if;
  delete from public.account_merges where from_user = v_uid or created_at < now() - interval '1 day';
  insert into public.account_merges (token, from_user) values (v_token, v_uid);
  return jsonb_build_object('token', v_token);
end;
$$;

-- Paso 2 (ya con la cuenta): canjea el vale y devuelve lo unido y el perfil de la cuenta.
create or replace function public.claim_account_merge(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  m public.account_merges;
  v_merged jsonb;
begin
  if game_private.is_guest(v_uid) then raise exception 'NOT_SIGNED_IN'; end if;
  select * into m from public.account_merges where token = p_token for update;
  if not found or m.used_at is not null or m.created_at < now() - interval '1 hour'
     or m.from_user = v_uid or not game_private.is_guest(m.from_user) then
    raise exception 'MERGE_INVALID';
  end if;
  update public.account_merges set used_by = v_uid, used_at = now() where token = p_token;
  -- En dos pasos: el perfil (función estable) no vería lo unido si se calculara en la misma consulta.
  v_merged := game_private.merge_account(m.from_user, v_uid);
  return jsonb_build_object('merged', v_merged, 'profile', game_private.profile(v_uid));
end;
$$;

-- Borra al jugador y todo su progreso (derecho de supresión). Antes sale de sus salas, para no
-- dejar a nadie esperando. En el historial de los demás queda el nombre que usó en esas
-- partidas, pero ya sin relación con ninguna cuenta.
create or replace function public.delete_my_account()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_room uuid;
  v_auth boolean := true;
begin
  for v_room in select room_id from public.room_players where user_id = v_uid loop
    perform game_private.lock_room(v_room, v_uid);
    if game_private.remove_player(v_room, v_uid, 'left') then
      perform game_private.touch(v_room);
    end if;
  end loop;
  update public.game_results
     set player_ids = array_replace(player_ids, v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
   where v_uid = any (player_ids);
  delete from public.account_merges where from_user = v_uid;
  delete from public.player_equipped where user_id = v_uid;
  delete from public.player_cosmetics where user_id = v_uid;
  delete from public.player_achievements where user_id = v_uid;
  delete from public.player_group_wins where user_id = v_uid;
  delete from public.player_stats where user_id = v_uid;
  delete from public.progress_events where user_id = v_uid;
  delete from public.match_rewards where user_id = v_uid;
  delete from public.coin_transactions where user_id = v_uid;
  delete from public.player_wallets where user_id = v_uid;
  delete from public.chat_messages where user_id = v_uid;
  delete from public.join_attempts where user_id = v_uid;
  -- Sus amigos dejan de verle al momento.
  perform game_private.bump_signal(f.friend_id) from public.friendships f where f.user_id = v_uid;
  perform game_private.bump_signal(r.to_user) from public.friend_requests r where r.from_user = v_uid;
  delete from public.friendships where user_id = v_uid or friend_id = v_uid;
  delete from public.friend_requests where from_user = v_uid or to_user = v_uid;
  delete from public.room_invites where from_user = v_uid or to_user = v_uid;
  delete from public.player_public where user_id = v_uid;
  delete from public.player_signals where user_id = v_uid;
  -- La cuenta en sí (con el correo, si inició sesión con Google).
  begin
    delete from auth.users where id = v_uid;
  exception when insufficient_privilege then
    v_auth := false;
  end;
  return jsonb_build_object('deleted', true, 'account', v_auth);
end;
$$;

-- ── Amigos (API) ──

-- Aviso de tiempo real a un jugador: su lista ha cambiado (nueva solicitud, amigo, invitación…).
create or replace function game_private.bump_signal(p_uid uuid)
returns void language sql set search_path = ''
as $$
  insert into public.player_signals (user_id, version) values (p_uid, 1)
  on conflict (user_id) do update set version = public.player_signals.version + 1, updated_at = now();
$$;

-- Crea la ficha pública con su código la primera vez. Sin I, O, 0, 1, como los códigos de sala.
create or replace function game_private.ensure_public(p_uid uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v text;
begin
  if exists (select 1 from public.player_public where user_id = p_uid) then return; end if;
  for attempt in 1..30 loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '')
      into v from generate_series(1, 8);
    insert into public.player_public (user_id, friend_code) values (p_uid, v) on conflict do nothing;
    if found then return; end if;
    if exists (select 1 from public.player_public where user_id = p_uid) then return; end if;
  end loop;
  raise exception 'INVALID_STATE';
end;
$$;

-- Una persona vista por otra: alias y título. Para quien no ha abierto la app desde que existen
-- los amigos (sin ficha pública) sirve el nombre por defecto.
create or replace function game_private.friend_card(p_uid uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_uid,
    'name', coalesce((select pp.name from public.player_public pp where pp.user_id = p_uid), 'Jugador'),
    'title', (select jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity)
                from public.player_equipped e join public.cosmetics c on c.id = e.cosmetic_id
               where e.user_id = p_uid and e.kind = 'title'));
$$;

-- Todo lo que la app necesita de los amigos. «Conectado» = la app ha dado señal hace menos de 90 s.
create or replace function game_private.friends_state(p_uid uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'code', (select friend_code from public.player_public where user_id = p_uid),
    'friends', coalesce((
      select jsonb_agg(game_private.friend_card(s.friend_id) || jsonb_build_object('status', s.status)
                       order by s.status = 'offline', lower(s.name))
      from (
        select f.friend_id, coalesce(pp.name, 'Jugador') as name,
               case when coalesce(pp.last_seen_at, 'epoch') < now() - interval '90 seconds' then 'offline'
                    when exists (select 1 from public.room_players rp join public.rooms r on r.id = rp.room_id
                                  where rp.user_id = f.friend_id and r.status in ('playing', 'level_complete')) then 'playing'
                    else 'online' end as status
        from public.friendships f
        left join public.player_public pp on pp.user_id = f.friend_id
        where f.user_id = p_uid
      ) s), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(game_private.friend_card(r.from_user) order by r.created_at desc)
                            from public.friend_requests r where r.to_user = p_uid), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(game_private.friend_card(r.to_user) order by r.created_at desc)
                            from public.friend_requests r where r.from_user = p_uid), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'fromName', i.from_name, 'expiresAt', i.expires_at)
                                          order by i.created_at desc)
                           from public.room_invites i where i.to_user = p_uid and i.expires_at > now()), '[]'::jsonb),
    'serverTime', now());
$$;

create or replace function game_private.make_friends(p_a uuid, p_b uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  insert into public.friendships (user_id, friend_id) values (p_a, p_b), (p_b, p_a) on conflict do nothing;
  delete from public.friend_requests where (from_user = p_a and to_user = p_b) or (from_user = p_b and to_user = p_a);
  perform game_private.bump_signal(p_a);
  perform game_private.bump_signal(p_b);
end;
$$;

-- Solicitud de p_from a p_to. Si p_to ya se la había pedido, son amigos directamente.
create or replace function game_private.request_friend(p_from uuid, p_to uuid)
returns text language plpgsql set search_path = ''
as $$
begin
  if p_from = p_to then raise exception 'CANNOT_ADD_SELF'; end if;
  if exists (select 1 from public.friendships where user_id = p_from and friend_id = p_to) then
    raise exception 'ALREADY_FRIENDS';
  end if;
  if exists (select 1 from public.friend_requests where from_user = p_to and to_user = p_from) then
    perform game_private.make_friends(p_from, p_to);
    return 'friends';
  end if;
  if (select count(*) from public.friend_requests where from_user = p_from) >= 50 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
  insert into public.friend_requests (from_user, to_user) values (p_from, p_to) on conflict do nothing;
  perform game_private.bump_signal(p_to);
  return 'requested';
end;
$$;

-- Lista de amigos, solicitudes e invitaciones.
create or replace function public.get_friends()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  perform game_private.ensure_public(v_uid);
  return game_private.friends_state(v_uid);
end;
$$;

-- «Sigo aquí»: la app lo llama mientras está abierta, con el alias actual (vive en el móvil).
create or replace function public.touch_presence(p_name text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  perform game_private.ensure_public(v_uid);
  update public.player_public
     set last_seen_at = now(), name = coalesce(game_private.clean_name(p_name), name)
   where user_id = v_uid;
  return jsonb_build_object('ok', true);
end;
$$;

-- Añadir con un código. Los códigos erróneos cuentan como los de sala: no se pueden probar a lo loco.
create or replace function public.add_friend(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_target uuid;
  v_result text;
begin
  perform game_private.ensure_public(v_uid);
  if (select count(*) from public.join_attempts
      where user_id = v_uid and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
  select user_id into v_target from public.player_public where friend_code = v_code;
  if not found then
    -- Se devuelve (en vez de lanzar) para que el intento fallido quede registrado.
    insert into public.join_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'FRIEND_NOT_FOUND');
  end if;
  v_result := game_private.request_friend(v_uid, v_target);
  return game_private.friends_state(v_uid) || jsonb_build_object('result', v_result);
end;
$$;

-- Añadir a alguien que está contigo en la sala (sin necesitar su código).
create or replace function public.add_friend_from_room(p_room uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_result text;
begin
  perform game_private.ensure_public(v_uid);
  if (select count(*) from public.room_players
      where room_id = p_room and user_id in (v_uid, p_target)) < 2 and v_uid <> coalesce(p_target, v_uid) then
    raise exception 'NOT_MEMBER';
  end if;
  v_result := game_private.request_friend(v_uid, p_target);
  return game_private.friends_state(v_uid) || jsonb_build_object('result', v_result);
end;
$$;

create or replace function public.respond_friend_request(p_from uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  if not exists (select 1 from public.friend_requests where from_user = p_from and to_user = v_uid) then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if p_accept then
    perform game_private.make_friends(v_uid, p_from);
  else
    delete from public.friend_requests where from_user = p_from and to_user = v_uid;
    perform game_private.bump_signal(p_from);
  end if;
  return game_private.friends_state(v_uid);
end;
$$;

create or replace function public.cancel_friend_request(p_to uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  delete from public.friend_requests where from_user = v_uid and to_user = p_to;
  perform game_private.bump_signal(p_to);
  return game_private.friends_state(v_uid);
end;
$$;

create or replace function public.remove_friend(p_friend uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  delete from public.friendships where (user_id = v_uid and friend_id = p_friend) or (user_id = p_friend and friend_id = v_uid);
  delete from public.room_invites where (from_user = v_uid and to_user = p_friend) or (from_user = p_friend and to_user = v_uid);
  perform game_private.bump_signal(p_friend);
  return game_private.friends_state(v_uid);
end;
$$;

-- Invita a un amigo a la sala en la que estás, en espera. Repetirla solo renueva la invitación.
create or replace function public.invite_friend(p_room uuid, p_friend uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  r public.rooms := game_private.lock_room(p_room, v_uid);
  v_expires timestamptz := now() + interval '2 minutes';
begin
  if r.status <> 'lobby' then raise exception 'NOT_IN_LOBBY'; end if;
  if not exists (select 1 from public.friendships where user_id = v_uid and friend_id = p_friend) then
    raise exception 'NOT_FRIENDS';
  end if;
  if exists (select 1 from public.room_players where room_id = p_room and user_id = p_friend) then
    raise exception 'ALREADY_IN_ROOM';
  end if;
  if (select count(*) from public.room_players where room_id = p_room) >= (r.config ->> 'maxPlayers')::int then
    raise exception 'ROOM_FULL';
  end if;
  insert into public.room_invites (room_id, from_user, to_user, from_name, expires_at)
  select p_room, v_uid, p_friend, p.name, v_expires from public.room_players p
   where p.room_id = p_room and p.user_id = v_uid
  on conflict (room_id, to_user) do update
    set from_user = excluded.from_user, from_name = excluded.from_name,
        created_at = now(), expires_at = excluded.expires_at;
  perform game_private.bump_signal(p_friend);
  return jsonb_build_object('invited', true, 'expiresAt', v_expires);
end;
$$;

-- Entra en la sala de la invitación (con las mismas comprobaciones que un código normal).
create or replace function public.accept_invite(p_invite bigint, p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := game_private.require_uid();
  v_code text;
begin
  select r.code into v_code
    from public.room_invites i join public.rooms r on r.id = i.room_id
   where i.id = p_invite and i.to_user = v_uid and i.expires_at > now();
  if not found then raise exception 'INVITE_EXPIRED'; end if;
  delete from public.room_invites where id = p_invite;
  return public.join_room(v_code, p_name);
end;
$$;

create or replace function public.decline_invite(p_invite bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := game_private.require_uid();
begin
  delete from public.room_invites where id = p_invite and to_user = v_uid;
  return game_private.friends_state(v_uid);
end;
$$;

-- Últimos movimientos de monedas del jugador.
create or replace function public.get_my_coin_history()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'amount', t.amount, 'balanceAfter', t.balance_after, 'kind', t.kind, 'reason', t.reason,
           'cosmeticId', t.cosmetic_id, 'at', t.created_at) order by t.id desc), '[]'::jsonb)
  from (select * from public.coin_transactions
         where user_id = (select auth.uid()) order by id desc limit 30) t;
$$;

-- Señal de vida para la tarea automática de GitHub (.github/workflows/keepalive.yml):
-- una consulta mínima cada pocos días evita que Supabase pause el proyecto gratuito por
-- inactividad. No lee ni escribe nada del juego.
create or replace function public.ping()
returns text language sql stable set search_path = ''
as $ping$
  select 'ok';
$ping$;

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
  public.propose_shield(uuid, uuid),
  public.pick_comodin(uuid, int, text),
  public.vote_shuriken(uuid, boolean),
  public.expire_shuriken_vote(uuid),
  public.ready_next_level(uuid, int, boolean),
  public.leave_room(uuid),
  public.kick_player(uuid, uuid),
  public.rematch(uuid),
  public.heartbeat(uuid),
  public.send_chat(uuid, text),
  public.get_my_history(),
  public.get_my_profile(),
  public.buy_cosmetic(text),
  public.equip_cosmetic(text),
  public.unequip_cosmetic(text),
  public.mark_achievements_seen(text[]),
  public.get_my_coin_history(),
  public.start_account_merge(),
  public.claim_account_merge(text),
  public.delete_my_account(),
  public.get_friends(),
  public.touch_presence(text),
  public.add_friend(text),
  public.add_friend_from_room(uuid, uuid),
  public.respond_friend_request(uuid, boolean),
  public.cancel_friend_request(uuid),
  public.remove_friend(uuid),
  public.invite_friend(uuid, uuid),
  public.accept_invite(bigint, text),
  public.decline_invite(bigint)
from public, anon;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

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
  public.propose_shield(uuid, uuid),
  public.pick_comodin(uuid, int, text),
  public.vote_shuriken(uuid, boolean),
  public.expire_shuriken_vote(uuid),
  public.ready_next_level(uuid, int, boolean),
  public.leave_room(uuid),
  public.kick_player(uuid, uuid),
  public.rematch(uuid),
  public.heartbeat(uuid),
  public.send_chat(uuid, text),
  public.get_my_history(),
  public.get_my_profile(),
  public.buy_cosmetic(text),
  public.equip_cosmetic(text),
  public.unequip_cosmetic(text),
  public.mark_achievements_seen(text[]),
  public.get_my_coin_history(),
  public.start_account_merge(),
  public.claim_account_merge(text),
  public.delete_my_account(),
  public.get_friends(),
  public.touch_presence(text),
  public.add_friend(text),
  public.add_friend_from_room(uuid, uuid),
  public.respond_friend_request(uuid, boolean),
  public.cancel_friend_request(uuid),
  public.remove_friend(uuid),
  public.invite_friend(uuid, uuid),
  public.accept_invite(bigint, text),
  public.decline_invite(bigint)
to authenticated;

-- ───────────────────────────── Tiempo real ─────────────────────────────
-- Solo se emiten la señal de versión de la sala, la señal de cada jugador y el chat. `hands` NUNCA se publica.
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
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'player_signals') then
      alter publication supabase_realtime add table public.player_signals;
    end if;
  end if;
end;
$$;
