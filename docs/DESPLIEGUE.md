# Publicar Unísono (Fase 7) — guía paso a paso

Tiempo estimado: 20–30 minutos. Coste: 0 €. No hace falta tarjeta.

| Paso | Dónde | ¿Manual o automático? |
|---|---|---|
| 1. Crear el proyecto de Supabase | supabase.com | **Manual** (es tu cuenta) |
| 2. Activar sesiones anónimas | Panel de Supabase | **Manual** |
| 3. Crear las tablas y la seguridad | Panel de Supabase → SQL Editor | **Manual** (copiar y pegar un archivo) |
| 4. Copiar la URL y la clave pública | Panel de Supabase | **Manual** |
| 5. Comprobar el servidor | Tu ordenador (`npm run smoke`) | Automático |
| 6. Subir el código a GitHub y publicar | GitHub | Automático con `gh` (o manual) |
| 7. Comprobación final y compartir | Tu móvil | Manual |

---

## 1. Crear el proyecto de Supabase

1. Entra en <https://supabase.com> y pulsa **Start your project**. Regístrate con tu cuenta de GitHub
   (lo más cómodo) o con email.
2. Pulsa **New project**.
   - **Name**: `unisono`
   - **Database Password**: pulsa *Generate a password* y guárdala en tu gestor de contraseñas.
     (El juego no la necesita, pero Supabase la pide.)
   - **Region**: la más cercana a vosotros (por ejemplo *West EU (Ireland)* o *Central EU (Frankfurt)*).
   - Plan: **Free**.
3. Pulsa **Create new project** y espera 1–2 minutos.

## 2. Activar las sesiones anónimas

Así cada móvil obtiene una identidad segura sin registrarse.

1. Menú izquierdo → **Authentication** → **Sign In / Providers** (en algunas versiones: *Providers*).
2. Activa **Allow anonymous sign-ins** y pulsa **Save**.

> Opcional y recomendado si la web se hace popular: en la misma sección puedes activar *CAPTCHA*
> (Cloudflare Turnstile) para frenar abusos. No es necesario para jugar entre amigos.

## 3. Crear las tablas, las funciones y la seguridad

1. Menú izquierdo → **SQL Editor** → **New query**.
2. Abre el archivo [`supabase/migrations/20261019000000_unisono.sql`](../supabase/migrations/20261019000000_unisono.sql),
   copia **todo** su contenido y pégalo en el editor.
3. Pulsa **Run**. Debe terminar con *Success. No rows returned*.
   (Si Supabase muestra un aviso sobre «operaciones destructivas», es por las líneas `revoke` y
   `drop policy if exists`: confirma con **Run this query**.)
4. Comprueba que existe: menú **Table Editor** → deberías ver `rooms`, `room_players`, `hands`…
   con la etiqueta **RLS enabled**.

El script se puede volver a ejecutar sin perder datos (por ejemplo, tras una actualización del juego).

## 4. Copiar la URL y la clave pública

1. Menú izquierdo → **Project Settings** (rueda dentada) → **API Keys**.
2. Copia la **Publishable key** (empieza por `sb_publishable_…`).
   Si tu proyecto solo muestra claves *legacy*, usa la **anon public** (es la versión antigua).
3. En **Project Settings → Data API** (o en el botón **Connect** de arriba) copia la **Project URL**
   (`https://xxxxxxxx.supabase.co`).

⚠️ **Nunca** copies la *Secret key* ni la *service_role key* en el proyecto: saltan todas las
protecciones. El juego no las necesita.

La URL y la publishable key **son públicas por diseño** (viajan dentro de la web). La seguridad
la garantizan las políticas RLS y las funciones del paso 3.

## 5. Comprobar el servidor desde tu ordenador

En la carpeta del proyecto, crea un archivo `.env.local` (no se sube a GitHub) copiando
`.env.example` y pon tus dos valores:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Después ejecuta:

```bash
npm install
```

```bash
npm run smoke
```

Simula tres móviles que crean una sala, se unen, comprueban que nadie ve las cartas de otro y
juegan una partida entera. Debe terminar con *«Todo correcto: el servidor está listo para jugar»*.

También puedes probar la web en tu ordenador con `npm run dev` y abrir <http://localhost:5173> en
dos ventanas (una normal y otra de incógnito, para que sean dos jugadores distintos).

## 6. Publicar en GitHub Pages

### Opción A — automática (desde la terminal, con `gh` ya conectado a tu cuenta)

```bash
git init -b main
```

```bash
git add -A && git commit -m "Unísono: primera versión"
```

```bash
gh repo create unisono --public --source . --push
```

```bash
gh variable set VITE_SUPABASE_URL --body "https://xxxxxxxx.supabase.co"
```

```bash
gh variable set VITE_SUPABASE_PUBLISHABLE_KEY --body "sb_publishable_..."
```

```bash
gh api -X POST repos/{owner}/unisono/pages -f build_type=workflow
```

```bash
gh workflow run "Desplegar en GitHub Pages"
```

### Opción B — manual (desde la web de GitHub)

1. Crea un repositorio **público** llamado `unisono` (en cuentas gratuitas, GitHub Pages requiere
   repositorio público; el código no contiene secretos).
2. Sube el código (por ejemplo con GitHub Desktop).
3. **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**:
   - `VITE_SUPABASE_URL` = tu Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = tu publishable key
4. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. **Actions → Desplegar en GitHub Pages → Run workflow**.

El *workflow* ejecuta las pruebas, compila y publica. En 1–2 minutos la web estará en:

```
https://TU-USUARIO.github.io/unisono/
```

Cada vez que subas cambios a `main` se volverá a publicar sola.

**Redirecciones**: no hacen falta. La app usa un único `index.html` y los enlaces de invitación
son `https://TU-USUARIO.github.io/unisono/?sala=CODIGO`.

**Dominio propio (opcional)**: Settings → Pages → *Custom domain*. No es necesario.

## 7. Comprobación final

1. Abre la URL pública en tu móvil (Safari o Chrome).
2. **Crear partida** → escribe tu alias → aparece el código.
3. Pulsa **Compartir invitación** y envíalo a un amigo (o ábrelo en otro móvil).
4. Tu amigo abre el enlace, escribe su alias y entra: ambos lo veis en la lista sin recargar.
5. Pulsa **Empezar partida**. Cada uno ve solo su carta. Jugad el nivel 1.
6. Prueba a cerrar la pestaña de uno de los dos y volver a abrir el enlace: recupera su sitio y sus cartas.

En iPhone: botón Compartir → **Añadir a pantalla de inicio** para tenerlo como una app.
En Android/Chrome: menú ⋮ → **Instalar aplicación** / **Añadir a pantalla de inicio**.

## Mantenimiento y límites

- **Pausa por inactividad**: Supabase pausa el proyecto gratuito tras 7 días sin actividad. Para
  evitarlo, la tarea automática `.github/workflows/keepalive.yml` llama al servidor cada 3 días
  (función `ping`). Si aun así se pausa, GitHub te avisa por correo: entra en el panel y pulsa
  **Restore project**. En repositorios públicos GitHub desactiva las tareas programadas tras 60 días
  sin cambios en el repositorio (avisa antes por correo); se reactiva en Actions → *Enable workflow*.
- **Usuarios anónimos antiguos**: Supabase no los borra solo. Si algún día quieres limpiar, en el
  SQL Editor: `delete from auth.users where is_anonymous and created_at < now() - interval '90 days';`
  (los jugadores afectados simplemente obtendrán una identidad nueva).
- **Límite de sesiones**: 30 sesiones anónimas nuevas por hora y por IP (ajustable en
  Authentication → Rate Limits). Cada móvil solo crea una la primera vez.
- **Costes futuros**: con el plan gratuito puedes tener hasta 200 conexiones simultáneas; para
  muchos más jugadores tendrías que pasar al plan Pro (≈ 25 $/mes). GitHub Pages es gratuito para
  repositorios públicos.

## Alternativa: Cloudflare Pages

Si prefieres Cloudflare (sin límite publicado de ancho de banda): crea un proyecto en
*Workers & Pages → Create → Pages → Connect to Git*, elige el repositorio, comando de compilación
`npm run build`, carpeta `dist`, y añade las dos variables `VITE_SUPABASE_*` en *Settings →
Environment variables*. No hacen falta redirecciones. El servidor (Supabase) es el mismo.
