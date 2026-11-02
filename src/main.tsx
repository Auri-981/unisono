import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setLanguage } from './i18n';
import { initAccount } from './ui/account';
import { applyMotionPref } from './ui/prefs';
import './styles/global.css';

setLanguage('es');
applyMotionPref();

const root = createRoot(document.getElementById('root')!);
const preview = import.meta.env.DEV ? new URLSearchParams(location.search).get('preview') : null;

// Prepara la sesión en segundo plano nada más abrir la web, para que «Crear sala» o «Entrar»
// no tengan que esperar a crearla (y, si vuelve de Google, termina de iniciar sesión).
if (!preview) void initAccount();

if (import.meta.env.DEV && preview) {
  // Herramienta de desarrollo: no se incluye en la compilación de producción.
  void import('./dev/Preview').then(({ Preview }) => root.render(<Preview kind={preview} />));
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
