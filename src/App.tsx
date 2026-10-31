/**
 * Navegación de la app. No usa rutas: todo vive en un único index.html y el enlace de
 * invitación es `?sala=CODIGO`, lo que evita problemas de redirecciones en GitHub Pages.
 */
import { useCallback, useState } from 'react';
import type { ExitReason } from './game/controller';
import type { RoomConfig, RoomSnapshot } from './game/types';
import { t } from './i18n';
import { api } from './net/api';
import { onlineAvailable } from './net/supabase';
import { getPrefs, storedRoom } from './ui/prefs';
import { EntryScreen } from './ui/screens/EntryScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { HistoryScreen, PracticeSetup, SettingsScreen } from './ui/screens/InfoScreens';
import { OnlineRoom, PracticeRoom } from './ui/screens/RoomScreens';
import { CollectionScreen, ShopScreen } from './ui/screens/ShopScreens';
import { TutorialScreen } from './ui/screens/TutorialScreen';

type Screen =
  | { name: 'home'; message?: string }
  | { name: 'create' }
  | { name: 'join'; code?: string }
  | { name: 'room'; roomId: string; initial: RoomSnapshot | null }
  | { name: 'practiceSetup' }
  | { name: 'practice'; bots: number; config: RoomConfig; run: number }
  | { name: 'tutorial' }
  | { name: 'settings' }
  | { name: 'history' }
  | { name: 'shop' }
  | { name: 'collection' };

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

/**
 * Dónde empieza la app:
 * - Misma pestaña/app todavía abierta (recarga, volver de otra app) → directamente a la sala.
 * - Abriendo un enlace de invitación de la sala en la que ya estabas → a la sala.
 * - App o pestaña cerrada del todo (salida a propósito) → inicio, y se abandona esa sala
 *   en el servidor para no dejar un jugador «fantasma» que bloquee a los demás.
 * Mientras estás en una sala la dirección queda limpia (sin ?sala=): así, si el sistema
 * restaura la pestaña al reabrir, no te mete otra vez en la sala sin querer.
 */
function initialScreen(): Screen {
  const urlCode = codeFromUrl();
  if (!onlineAvailable) return { name: 'home' };
  const active = storedRoom.active();
  if (active && (!urlCode || urlCode === active.code)) return { name: 'room', roomId: active.id, initial: null };
  const stored = storedRoom.get();
  if (urlCode && stored?.code === urlCode) {
    setUrlCode(null);
    storedRoom.set(stored);
    return { name: 'room', roomId: stored.id, initial: null };
  }
  if (stored) {
    // Cerró la app/pestaña a propósito: sale de esa sala (si falla la red, el anfitrión puede expulsarle).
    void api.leaveRoom(stored.id).catch(() => {});
    storedRoom.set(null);
  }
  if (urlCode) return { name: 'join', code: urlCode };
  return { name: 'home' };
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const home = useCallback((message?: string) => setScreen({ name: 'home', message }), []);

  const enterRoom = useCallback((snap: RoomSnapshot) => {
    // Si entras en otra sala distinta, se abandona la anterior para no quedar como jugador fantasma.
    const previous = storedRoom.get();
    if (previous && previous.id !== snap.room.id) void api.leaveRoom(previous.id).catch(() => {});
    storedRoom.set({ id: snap.room.id, code: snap.room.code });
    setUrlCode(null);
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
          message={screen.message ?? null}
          onCreate={() => setScreen({ name: 'create' })}
          onJoin={() => setScreen({ name: 'join' })}
          onPractice={() => setScreen({ name: 'practiceSetup' })}
          onTutorial={() => setScreen({ name: 'tutorial' })}
          onSettings={() => setScreen({ name: 'settings' })}
          onHistory={() => setScreen({ name: 'history' })}
          onShop={() => setScreen({ name: 'shop' })}
          onCollection={() => setScreen({ name: 'collection' })}
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
    case 'tutorial':
      return (
        <TutorialScreen
          onBack={() => home()}
          onPractice={() => setScreen({ name: 'practiceSetup' })}
          onCreate={() => setScreen({ name: 'create' })}
          canCreate={onlineAvailable}
        />
      );
    case 'settings':
      return <SettingsScreen onBack={() => home()} />;
    case 'history':
      return <HistoryScreen onBack={() => home()} />;
    case 'shop':
      return <ShopScreen onBack={() => home()} onCollection={() => setScreen({ name: 'collection' })} />;
    case 'collection':
      return <CollectionScreen onBack={() => home()} onShop={() => setScreen({ name: 'shop' })} />;
  }
}
