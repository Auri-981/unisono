# Unísono

Juego cooperativo de cartas para jugar con amigos desde el móvil, inspirado en la mecánica de
*The Mind*: jugad todas las cartas del 1 al 100 en orden ascendente… sin decir ni un número.

- Multijugador online real (2–4 jugadores) con salas privadas, código e enlace de invitación.
- Sin cuentas ni datos personales: cada móvil recibe una sesión anónima segura.
- Las cartas de cada jugador son privadas **en el servidor** (Row Level Security), no solo ocultas en pantalla.
- Vidas y tres comodines con votación (Vistazo, Escudo y Rebobinar), recompensas configurables con
  elección de comodín, ronda relámpago con reloj (un nivel al azar por partida), ronda final
  (el último nivel: sin comodines, mesa a ciegas y manos ocultas), orden ascendente o descendente, revancha, historial, chat opcional.
  (En el código y la base de datos el vistazo se llama internamente «shuriken».)
- Monedas por jugar online (más por cada nivel superado y mucho más por ganar partidas largas),
  tienda con diseños de cartas (Galaxia, Neón, Esmeralda) y «Mis cartas» para equiparlos.
- Modo práctica contra bots, sin conexión.
- Web móvil instalable (PWA). Interfaz en español, preparada para otros idiomas.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Decisiones técnicas, modelo de datos, seguridad, máquina de estados, límites gratuitos |
| [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) | **Guía paso a paso para publicarlo gratis** |
| [docs/PRUEBAS.md](docs/PRUEBAS.md) | Qué se ha verificado, cómo, y qué queda pendiente |

## Estructura

```
src/
  config/gameConfig.ts     Reglas configurables (niveles, vidas, recompensas…) — fuente única
  game/                    Motor de reglas puro (TypeScript) + tipos compartidos + pruebas
  net/                     Cliente de Supabase, llamadas al servidor y sincronización en tiempo real
  practice/                Modo práctica con bots (usa el mismo motor)
  ui/                      Pantallas y componentes (React)
  i18n/                    Textos (es.ts)
  styles/global.css        Diseño visual
supabase/migrations/       Base de datos, seguridad (RLS) y lógica autoritativa del servidor (SQL)
tests/                     Escenarios compartidos + pruebas de integración contra Postgres real
scripts/smoke.mjs          Prueba de extremo a extremo contra tu Supabase real
.github/workflows/         Publicación automática en GitHub Pages
```

## Comandos

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run smoke
```

- `npm run dev`: web local en <http://localhost:5173> (sin `.env.local` solo funciona el modo práctica).
- `npm test`: motor de reglas + servidor SQL real en memoria (PGlite).
- `npm run smoke`: requiere `.env.local` con tu proyecto de Supabase (ver `.env.example`).

## Licencia y marca

Código propio. «Unísono» es un nombre provisional; el juego no usa nombres, logotipos ni recursos
gráficos de *The Mind* (Nürnberger-Spielkarten-Verlag / Pandasaurus Games).
