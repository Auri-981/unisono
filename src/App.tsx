/**
 * Navegación de la app. No usa rutas: todo vive en un único index.html y el enlace de
 * invitación es `?sala=CODIGO`, lo que evita problemas de redirecciones en GitHub Pages.
 */
import { useCallback, useState } from 'react';
import type { ExitReason } from './game/controller';
import type { RoomConfig, RoomSnapshot } from './game/types';
import { t } from './i18n';
import { onlineAvailable } from './net/supabase';
import { getPrefs, storedRoom } from './ui/prefs';
import { EntryScreen } from './ui/screens/EntryScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { HistoryScreen, PracticeSetup, RulesScreen, SettingsScreen } from './ui/screens/InfoScreens';
import { OnlineRoom, PracticeRoom } from './ui/screens/RoomScreens';

type Screen =
  | { name: 'home'; message?: string }
  | { name: 'create' }
  | { name: 'join'; code?: string }
  | { name: 'room'; roomId: string; initial: RoomSnapshot | null }
  | { name: 'practiceSetup' }
  | { name: 'practice'; bots: number; config: RoomConfig; run: number }
  | { name: 'rules' }
  | { name: 'settings' }
  | { name: 'history' };

function codeFromUrl(): string | undefined {
  try {
    const raw = new URLSearchParams(window.location.search).get('sala');
    const code = raw?.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return code && code.length === 5 ? code : undefined;
  } catch {
    return undefined;
  }
}

function setUrlCode(code: string | null) {
  const url = new URL(window.location.href);
  url.search = code ? `?sala=${code}` : '';
  window.history.replaceState(null, '', url.toString());
}

function initialScreen(): Screen {
  const urlCode = codeFromUrl();
  const stored = storedRoom.get();
  if (onlineAvailable && stored && (!urlCode || urlCode === stored.code)) {
    setUrlCode(stored.code); // al reanudar, la barra de direcciones vuelve a mostrar el enlace de la sala
    return { name: 'room', roomId: stored.id, initial: null };
  }
  if (urlCode) return onlineAvailable ? { name: 'join', code: urlCode } : { name: 'home' };
  return { name: 'home' };
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const home = useCallback((message?: string) => setScreen({ name: 'home', message }), []);

  const enterRoom = useCallback((snap: RoomSnapshot) => {
    storedRoom.set({ id: snap.room.id, code: snap.room.code });
    setUrlCode(snap.room.code);
    setScreen({ name: 'room', roomId: snap.room.id, initial: snap });
  }, []);

  const exitRoom = useCallback(
    (reason: ExitReason) => {
      storedRoom.set(null);
      setUrlCode(null);
      home(reason === 'left' ? undefined : t(reason === 'gone' ? 'exit.gone' : 'exit.kicked'));
    },
    [home],
  );

  switch (screen.name) {
    case 'home':
      return (
        <HomeScreen
          resume={storedRoom.get()}
          message={screen.message ?? null}
          onCreate={() => setScreen({ name: 'create' })}
          onJoin={() => setScreen({ name: 'join' })}
          onResume={() => {
            const s = storedRoom.get();
            if (s) setScreen({ name: 'room', roomId: s.id, initial: null });
          }}
          onPractice={() => setScreen({ name: 'practiceSetup' })}
          onRules={() => setScreen({ name: 'rules' })}
          onSettings={() => setScreen({ name: 'settings' })}
          onHistory={() => setScreen({ name: 'history' })}
        />
      );
    case 'create':
      return <EntryScreen mode="create" onBack={() => home()} onEntered={enterRoom} />;
    case 'join':
      return (
        <EntryScreen
          mode="join"
          initialCode={screen.code}
          onBack={() => {
            setUrlCode(null);
            home();
          }}
          onEntered={enterRoom}
        />
      );
    case 'room':
      return <OnlineRoom key={screen.roomId} roomId={screen.roomId} initial={screen.initial} onExit={exitRoom} />;
    case 'practiceSetup':
      return (
        <PracticeSetup
          onBack={() => home()}
          onStart={(bots, config) => setScreen({ name: 'practice', bots, config, run: Date.now() })}
        />
      );
    case 'practice':
      return (
        <PracticeRoom
          key={screen.run}
          bots={screen.bots}
          config={screen.config}
          myName={getPrefs().name.trim() || 'Tú'}
          onExit={() => home()}
        />
      );
    case 'rules':
      return <RulesScreen onBack={() => home()} />;
    case 'settings':
      return <SettingsScreen onBack={() => home()} />;
    case 'history':
      return <HistoryScreen onBack={() => home()} />;
  }
}
