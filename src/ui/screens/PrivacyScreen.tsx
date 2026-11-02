/**
 * Política de privacidad. Se abre desde Ajustes y con el enlace `?privacidad` (el que se da a
 * Google al configurar el inicio de sesión). Es un texto legal: se mantiene solo en español.
 */
import { t } from '../../i18n';
import { Page } from '../components/Layout';

const UPDATED = '2 de noviembre de 2026';
const PROJECT = 'https://github.com/Auri-981/unisono';

export function PrivacyScreen({ onBack }: { onBack: () => void }) {
  return (
    <Page title={t('privacy.title')} onBack={onBack} className="page-privacy">
      <article className="privacy">
        <p className="muted small">Última actualización: {UPDATED}</p>
        <p>
          Unísono es un juego gratuito. Aquí te contamos, sin letra pequeña, qué datos se guardan, para qué y cómo
          borrarlos.
        </p>

        <h2>Quién es responsable</h2>
        <p>
          Unísono lo hace un particular. Para cualquier duda o petición sobre tus datos, escribe en la página del
          proyecto:{' '}
          <a href={`${PROJECT}/issues`} target="_blank" rel="noreferrer">
            github.com/Auri-981/unisono
          </a>{' '}
          (apartado «Issues»). Para borrarlo todo no hace falta escribir: puedes hacerlo tú desde Ajustes.
        </p>

        <h2>Qué se guarda</h2>
        <ul>
          <li>
            <strong>Si juegas como invitado:</strong> un identificador anónimo al azar (sin nombre ni correo), el alias
            que escribes para jugar, tus partidas (resultado, nivel y alias de quienes jugaron), y tus monedas, cartas,
            títulos, logros y estadísticas.
          </li>
          <li>
            <strong>Si inicias sesión con Google:</strong> además, el correo, el nombre y la foto de perfil que Google
            comparte, para reconocer tu cuenta. Nunca vemos ni guardamos tu contraseña de Google.
          </li>
          <li>
            <strong>El chat de la sala:</strong> los mensajes se borran junto con la sala, como mucho 12 horas después de
            que se deje de usar.
          </li>
          <li>
            <strong>En tu navegador:</strong> la sesión, tus ajustes y una copia de tu perfil para que cargue rápido. Es
            solo lo necesario para que el juego funcione: no hay cookies de publicidad ni de seguimiento.
          </li>
        </ul>

        <h2>Para qué</h2>
        <p>
          Solo para que el juego funcione: jugar en salas con tus amigos, guardar tu progreso y, si inicias sesión,
          llevarlo a otros móviles. No hay publicidad, no se venden ni se ceden tus datos a nadie y no se hacen perfiles
          sobre ti.
        </p>

        <h2>Por qué se pueden usar</h2>
        <p>
          Porque son necesarios para darte el servicio que pides (jugar y guardar tu progreso). Iniciar sesión con Google
          es opcional: lo decides tú.
        </p>

        <h2>Dónde están</h2>
        <ul>
          <li>
            <strong>Supabase</strong> guarda la base de datos y las sesiones, en servidores de la Unión Europea
            (Irlanda).
          </li>
          <li>
            <strong>GitHub Pages</strong> sirve la web. Como cualquier servidor, puede registrar tu dirección IP al
            cargarla.
          </li>
          <li>
            <strong>Google</strong> solo interviene si eliges iniciar sesión con tu cuenta de Google.
          </li>
        </ul>

        <h2>Cuánto tiempo</h2>
        <p>
          Mientras sigas jugando. Puedes borrarlo todo cuando quieras en Ajustes → «Borrar mi cuenta y mis datos»: se
          borran al momento tus monedas, cartas, títulos, logros, estadísticas y tu cuenta. En el historial de quienes
          jugaron contigo queda el alias que usaste en esas partidas, ya sin relación con ninguna cuenta.
        </p>

        <h2>Tus derechos</h2>
        <p>
          Puedes pedir ver tus datos, corregirlos, borrarlos, llevártelos o que se dejen de usar, por el contacto de
          arriba. Si crees que no se han respetado tus derechos, puedes reclamar ante la Agencia Española de Protección
          de Datos (
          <a href="https://www.aepd.es" target="_blank" rel="noreferrer">
            aepd.es
          </a>
          ).
        </p>

        <h2>Menores</h2>
        <p>Si tienes menos de 14 años, pide permiso a tu padre, madre o tutor antes de iniciar sesión con Google.</p>
      </article>
    </Page>
  );
}
