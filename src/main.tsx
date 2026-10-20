import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setLanguage } from './i18n';
import { ensureSession, onlineAvailable } from './net/supabase';
import { applyMotionPref } from './ui/prefs';
import './styles/global.css';

setLanguage('es');
applyMotionPref();

// Prepara la sesión anónima en segundo plano nada más abrir la web, para que
// «Crear sala» o «Entrar» no tengan que esperar a crearla.
if (onlineAvailable) void ensureSession().catch(() => {});

const root = createRoot(document.getElementById('root')!);
const preview = import.meta.env.DEV ? new URLSearchParams(location.search).get('preview') : null;

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
