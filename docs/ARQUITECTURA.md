# Unísono — Arquitectura (Fase 1)

> «Unísono» es el nombre provisional del juego. Está inspirado en la mecánica de *The Mind*,
> pero no usa su nombre, logotipo, ilustraciones ni recursos gráficos.

## 1. La decisión en una frase

**Web estática (React + TypeScript + Vite) publicada gratis en GitHub Pages, y Supabase como
"servidor": base de datos Postgres con reglas de seguridad (RLS), funciones SQL que actúan de
árbitro de la partida, sesiones anónimas y tiempo real.**

No hay ningún servidor propio que mantener encendido. Supabase es el árbitro; GitHub Pages solo
sirve los archivos de la web.

```
 Móvil A ─┐                         ┌───────────── Supabase (gratis) ─────────────┐
 Móvil B ─┼─ HTTPS ─► GitHub Pages  │  Auth anónima  → cada móvil tiene un id fiable │
 Móvil C ─┘   (HTML/JS/CSS)         │  Funciones SQL → validan y aplican jugadas    │
     │                              │  Tablas + RLS  → cada uno solo lee sus cartas │
     └────── WebSocket / HTTPS ────►│  Realtime      → avisa "la sala ha cambiado"  │
                                    └──────────────────────────────────────────────┘
```

## 2. Por qué estas piezas

| Pieza | Para qué | Por qué esta y no otra |
|---|---|---|
| React 19 + TypeScript | Pantallas y tipos seguros | Estándar, muy documentado, fácil de mantener. |
| Vite | Desarrollo y compilación | Rápido, sin configuración complicada. |
| CSS propio con variables | Estilos | Sin dependencias extra; el juego carga muy rápido. |
| Supabase | Base de datos, sesiones, tiempo real | Ofrece todo lo necesario en el plan gratuito, sin servidor propio. |
| Funciones SQL (`security definer`) | Árbitro de las jugadas | Se ejecutan *dentro* de la base de datos: rápidas (importante en un juego de reflejos) y atómicas. |
| GitHub Pages | Publicar la web | Ya usas GitHub; el despliegue es automático al subir cambios. |

**¿Por qué funciones SQL y no Edge Functions?** En este juego el tiempo importa: una jugada debe
validarse en milisegundos. Una función SQL bloquea la sala, comprueba la jugada y la guarda en una
sola transacción, sin arranques en frío. Además, el despliegue para ti se reduce a pegar un archivo
SQL en el editor de Supabase.

**GitHub Pages frente a Cloudflare Pages.** Ambas sirven perfectamente una web estática y ninguna
ejecuta el multijugador (eso lo hace Supabase). Elijo **GitHub Pages** porque es una cuenta menos que
gestionar: el código y la web viven en el mismo sitio y un *workflow* publica cada cambio.
Cloudflare Pages queda documentada como alternativa (ancho de banda sin límite publicado, previsualizaciones
por rama). Para evitar problemas de rutas en alojamiento estático, la app usa un único `index.html`
y el enlace de invitación es `.../?sala=CODIGO`: no hacen falta redirecciones.

## 3. La privacidad de las cartas (requisito crítico)

1. Cada móvil inicia una **sesión anónima** de Supabase (sin email ni contraseña). Supabase firma un
   token (JWT) con un identificador `uid` que el navegador **no puede falsificar**.
2. Las cartas están en la tabla `hands`, con **Row Level Security**: la única política de lectura es
   `user_id = auth.uid()`. Aunque alguien consulte la API a mano, solo recibe sus filas.
3. Los clientes **no tienen permiso de escritura en ninguna tabla**. Todo cambio pasa por funciones
   SQL que comprueban quién llama (`auth.uid()`), si pertenece a la sala y si la acción es legal.
4. La tabla `hands` **no se emite por tiempo real**. Lo único que se emite es la fila pública de la
   sala (`rooms`: nivel, vidas, pila de cartas jugadas, versión…). Al ver un cambio, cada móvil pide
   su "foto" de la partida (`get_room_state`), que incluye solo *su* mano y cuántas cartas tienen los
   demás (como en la mesa real), nunca sus valores.
5. Solo se revelan cartas cuando las reglas lo hacen: las descartadas por un error y las
   descartadas por un vistazo (shuriken).

Las pruebas de integración (`tests/integration`) ejecutan el SQL real e intentan leer cartas ajenas,
escribir en tablas y llamar a funciones internas; todo debe fallar.

## 4. Modelo de datos

| Tabla | Contenido | Quién puede leer | Quién escribe |
|---|---|---|---|
| `rooms` | Código, anfitrión, estado, configuración, nivel, vidas, comodines (`shurikens`, `rewinds`, `shields`), escudo activo, elección de comodín pendiente (`offer`), ronda relámpago (`lightning_level`, `lightning_ends_at`), pila y hora de la última carta (`pile_at`), votación, último evento, `version` | Miembros de la sala | Solo funciones |
| `room_players` | Jugador, alias, asiento, «listo», última señal de vida | Miembros | Solo funciones |
| `hands` | Una fila por carta: sala, jugador, valor (clave única sala+carta) | **Solo el dueño** | Solo funciones |
| `room_events` | Registro de lo ocurrido (jugadas, errores, recompensas) | Miembros | Solo funciones |
| `chat_messages` | Mensajes (solo modo amigos) | Miembros | Solo funciones |
| `processed_actions` | Ids de acciones ya aplicadas (anti-duplicados) | Nadie | Solo funciones |
| `join_attempts` | Intentos fallidos de unión (anti-fuerza bruta) | Nadie | Solo funciones |
| `game_results` | Historial de partidas terminadas | Nadie (vía función `get_my_history`) | Solo funciones |

La clave primaria `(room_id, card)` de `hands` hace **imposible** que una carta esté en dos manos.

## 5. Funciones del servidor (la API del juego)

`create_room`, `join_room`, `get_room_state`, `update_config`, `set_lobby_ready`, `start_game`,
`play_card`, `propose_shuriken`, `propose_shield`, `vote_shuriken` (vota cualquier comodín),
`expire_shuriken_vote`, `pick_comodin`, `ready_next_level`,
`leave_room`, `kick_player`, `rematch`, `heartbeat`, `send_chat`, `get_my_history`.

Todas las que modifican la partida:
- empiezan con `SELECT … FOR UPDATE` sobre la sala → **las jugadas de una sala se procesan de una en
  una**, en un orden inequívoco, aunque dos personas pulsen a la vez;
- incrementan `rooms.version` → un móvil nunca sustituye un estado nuevo por uno viejo;
- aceptan un `action_id` (jugar carta, proponer vistazo o escudo) → un reintento de red no se aplica dos veces;
- `play_card` exige además el **valor** de la carta pulsada: una doble pulsación no juega la siguiente.

## 6. Máquina de estados

Estados persistentes de la sala (`rooms.status`):

```
lobby ──start_game──► playing ──(todas las manos vacías, nivel < máximo)──► level_complete
  ▲                    │  ▲                                                     │
  │                    │  └─────────── todos «listos» (o el anfitrión fuerza) ──┘
  │                    ├──(todas las manos vacías en el último nivel)──► won
  │                    ├──(vidas = 0)──► lost
  │                    └──(quedan < 2 jugadores)──► abandoned
  └──────────── rematch (anfitrión) ◄──── won / lost / abandoned
```

Los estados transitorios que pide el diseño se modelan como **eventos** dentro de una transacción
(el último queda en `rooms.last_event` para animaciones y mensajes):

| Estado pedido | Cómo se representa |
|---|---|
| Sala esperando / preparación | `lobby` (+ «listo» por jugador) |
| Inicio de nivel / siguiente nivel | evento `game_start` / `level_start` (+ cuenta atrás visual opcional) |
| Nivel en curso | `playing` |
| Resolución de jugada | evento `play` |
| Penalización | evento `mistake` (cartas descartadas, vida perdida) |
| Uso de un comodín | `rooms.vote` (`kind`: shuriken / shield / rewind) + eventos `shuriken_proposed` / `shuriken_used` / `shield_used` / `rewind_offered` / `rewind_used` / `shuriken_cancelled` |
| Nivel superado + recompensa | `level_complete` + `rooms.last_reward`; si hay comodín a elegir, `rooms.offer` + evento `comodin_chosen` |
| Victoria / derrota / abandono | `won` / `lost` / `abandoned` |

## 7. Reglas implementadas

- Baraja 1–100 sin repetidos, barajada con aleatoriedad criptográfica (`gen_random_uuid`), reparto
  en rueda: nivel *n* → *n* cartas por jugador.
- Solo se puede jugar **la carta más baja** de la propia mano.
- **Error**: si al jugar la carta *c* alguien conserva cartas menores que *c*, el equipo pierde
  **exactamente una vida** y **todas** esas cartas menores se descartan boca arriba.
- **Shuriken**: cualquiera propone; todos los jugadores deben aceptar en 15 s; cualquiera puede
  rechazar. Mientras hay votación no se pueden jugar cartas. Cada jugador descarta su carta más baja
  y la muestra a todos.
- **Escudo**: se propone y vota igual que el vistazo. Aceptado, el siguiente error del nivel no
  cuesta vida (las cartas sí se descartan). Caduca al terminar el nivel.
- **Rebobinar**: no se propone. Si se pierde una vida y el equipo tiene alguno, la partida se
  detiene y se vota (20 s, unanimidad). Aceptado, se recupera la vida; las cartas descartadas no
  vuelven. Si no se acepta (o caduca, o alguien sale), la vida se pierde y, si era la última, la
  partida termina. Un escudo activo evita la pregunta (no se pierde vida).
- Si te rechazan (o caduca) un vistazo o un escudo, no puedes proponer otro comodín hasta que se
  juegue una carta.
- Si las manos quedan vacías tras un error o un shuriken, el nivel también se supera.
- **Ronda relámpago**: al empezar la partida se sortea un nivel (nunca el último; ninguno si la
  partida tiene un solo nivel). Al repartirlo se fija `lightning_ends_at` = ahora + 6 s (aviso
  «¡Alerta! Ronda relámpago» y cuenta atrás) + `least(90, 57 + 3·nivel)` s (60 s en el nivel 1,
  90 s del 11 en adelante). Si llega la hora con cartas en la mesa, vidas a 0 y partida perdida
  (evento `lightning_timeout` + `lost`), aunque haya una votación en curso. El reloj no se para
  en las votaciones. No hay temporizador en el servidor: lo aplica cualquier acción posterior o
  `expire_shuriken_vote`, que los móviles llaman cuando su reloj llega a cero.
- **Ronda final**: el último nivel (también si la partida tiene uno solo) es más difícil:
  - *Sin comodines*: `propose_shuriken` y `propose_shield` devuelven `FINAL_ROUND`, y un error no
    ofrece Rebobinar. Por eso, al superar el nivel anterior no se reparten comodines (sí vidas).
  - *Mesa a ciegas*: `pile_at` guarda cuándo se jugó la última carta. Durante el nivel, la foto
    (`get_room_state`) solo incluye esa carta los 3 primeros segundos; las demás no se envían
    (`pileHidden` dice cuántas hay boca abajo) y el evento `play` no lleva el número.
  - *Manos ocultas*: `cardsLeft` de los demás jugadores llega como `null` (el propio, sí).
  Al terminar la partida la mesa vuelve a verse entera.
- Configuración clásica (centralizada en `src/config/gameConfig.ts` y su espejo SQL):
  2 jugadores → 12 niveles, 2 vidas, 1 shuriken · 3 → 10, 3, 1 · 4 → 8, 4, 1.
- **Recompensas clásicas**: nivel 2 ★, 3 ♥, 5 ★, 6 ♥, 8 ★, 9 ♥; máximo 5 vidas y 3 de cada comodín.
  ★ = un comodín a elegir (en el juego original era un shuriken): se ofrecen 2 de los 3 al azar, sin
  los que ya están al máximo (si solo queda uno, se da directamente). Cada jugador vota; cuando han
  votado todos gana el más votado y, si hay empate, se decide al azar. No se pasa de nivel hasta
  elegir (el anfitrión puede forzarlo). En la tabla de recompensas el campo se sigue llamando
  `shurikens` por compatibilidad.
  *Verificación*: las reglas oficiales indican que la recompensa figura en cada carta de nivel; la
  correspondencia exacta procede de fuentes secundarias coherentes entre sí (WikiBoardGames,
  RulesPal). Por eso es configurable.
- **Recompensas personalizadas** (por defecto): 2 ★, 3 ♥, 5 ★, 6 ♥, editable en una tabla.
- **Dificultad**: fácil (+1 vida, +1 shuriken), clásica, difícil (−1 vida, sin shuriken).

**Vistazo**: como en el juego publicado, las cartas descartadas se muestran siempre boca arriba
(antes había una opción «clásica» que las ocultaba; se quitó).

## 8. Conexión, desconexión y anfitrión

- Cerrar la pestaña **no** borra al jugador: la sesión anónima se guarda en el navegador y, al volver
  a abrir el enlace, el jugador recupera su sitio y sus cartas desde el servidor.
- Cada móvil envía un `heartbeat` cada 15 s. Si el anfitrión lleva más de 45 s sin señal, el rol pasa
  automáticamente al jugador conectado más reciente.
- El indicador verde/gris de cada jugador usa *Presence* de Supabase Realtime.
- Al volver de segundo plano, recuperar la red o reconectar el canal, el móvil vuelve a pedir el
  estado completo (no depende de no haberse perdido ningún evento).
- Abandonar voluntariamente durante la partida descarta tus cartas; si quedan menos de 2 jugadores la
  partida pasa a «abandonada». El anfitrión puede expulsar a alguien que no vuelve.
- Salas sin actividad durante 12 h se borran automáticamente (limpieza al crear salas).

## 9. Límites del plan gratuito y costes posibles

Comprobado en la web de Supabase y la documentación de GitHub (octubre de 2026):

| Servicio | Límite gratuito relevante | Qué significa para ti |
|---|---|---|
| Supabase | 500 MB de base de datos, 5 GB de transferencia, 200 conexiones de tiempo real simultáneas, 2 M mensajes/mes, 2 proyectos | Sobra para jugar con amigos (cada jugador ≈ 1 conexión). |
| Supabase | **El proyecto se pausa tras 1 semana sin actividad** | Si nadie juega en una semana, entras en el panel y pulsas «Restore». |
| Supabase Auth anónima | 30 sesiones nuevas por hora y por IP (ajustable) | Normal entre amigos; documentado por si os juntáis muchos en la misma wifi. |
| GitHub Pages | 1 GB de web, 100 GB/mes de tráfico (límite blando); en cuentas gratuitas el repositorio debe ser público | La web pesa < 1 MB. El código será público, sin secretos. |

**Costes**: desarrollo 0 €; alojamiento 0 € dentro de esas cuotas. Si algún día lo superáis, el plan
Pro de Supabase cuesta unos 25 $/mes. Nada de esto es gratuito "para siempre": los proveedores pueden
cambiar sus planes.

## 10. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Ver cartas ajenas | RLS + funciones; `hands` fuera del tiempo real; pruebas específicas. |
| Jugadas simultáneas | Bloqueo de la fila de la sala; orden de procesamiento único. |
| Doble pulsación / reintentos | `action_id` + valor de carta obligatorio; botón bloqueado mientras se envía. |
| Eventos perdidos al cambiar de app | Re-sincronización completa al volver, al reconectar y en cada heartbeat. |
| Lógica duplicada TS/SQL | El motor TypeScript (modo práctica) y el SQL (partidas online) se prueban con los **mismos escenarios**. |
| Probar todo sin servidor propio | Pruebas con Postgres real en memoria (PGlite) + script `smoke` contra tu Supabase real. |
| Fuerza bruta de códigos | Códigos de 5 caracteres (≈28 millones), límite de intentos fallidos y de sesiones por IP. |

## 11. Preparado para crecer

- **PWA**: incluye `manifest`; se puede añadir a la pantalla de inicio en iOS y Android.
- **App móvil**: el mismo código puede empaquetarse con Capacitor si algún día merece la pena.
- **Idiomas**: todos los textos están en `src/i18n/es.ts`; añadir otro idioma es añadir un archivo.
- **Variantes**: la configuración de la sala es un objeto validado en servidor; añadir reglas nuevas no
  cambia el modelo de datos.
- **Perfiles / emparejamiento**: la sesión anónima puede convertirse en cuenta permanente
  (*identity linking* de Supabase) sin perder el historial.
