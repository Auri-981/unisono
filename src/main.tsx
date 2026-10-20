import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setLanguage } from './i18n';
import { applyMotionPref } from './ui/prefs';
import './styles/global.css';

setLanguage('es');
applyMotionPref();

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
