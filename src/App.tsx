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
import { AchievementNotices } from './ui/components/AchievementNotices';
import { AutoUpdate } from './ui/components/AutoUpdate';
import { getPrefs, storedRoom } from './ui/prefs';
import { EntryScreen } from './ui/screens/EntryScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { KickedScreen } from './ui/screens/KickedScreen';
import { HistoryScreen, PracticeSetup, SettingsScreen } from './ui/screens/InfoScreens';
import { OnlineRoom, PracticeRoom } from './ui/screens/RoomScreens';
import { AchievementsScreen, ProfileScreen } from './ui/screens/ProgressScreens';
import { CollectionScreen, ShopScreen, type CosmeticTab } from './ui/screens/ShopScreens';
import { TutorialScreen } from './ui/screens/TutorialScreen';

type Screen =
  | { name: 'home'; message?: string }
  | { name: 'kicked'; code?: string }
  | { name: 'create' }
  | { name: 'join'; code?: string }
  | { name: 'room'; roomId: string; initial: RoomSnapshot | null }
  | { name: 'practiceSetup' }
  | { name: 'practice'; bots: number; config: RoomConfig; run: number }
  | { name: 'tutorial' }
  | { name: 'settings' }
  | { name: 'history' }
  | { name: 'shop'; tab?: CosmeticTab }
  | { name: 'collection'; tab?: CosmeticTab }
  | { name: 'achievements' }
  | { name: 'profile' };

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

/** Pantallas donde recargar haría perder algo (la partida online la retiene GameScreen). */
const HOLD_UPDATE_SCREENS = new Set<Screen['name']>(['practice', 'tutorial', 'create', 'join']);

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  return (
    <>
      <Screens screen={screen} setScreen={setScreen} />
      {onlineAvailable && <AchievementNotices />}
      <AutoUpdate blocked={HOLD_UPDATE_SCREENS.has(screen.name)} />
    </>
  );
}

function Screens({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
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
      const code = storedRoom.get()?.code;
      storedRoom.set(null);
      setUrlCode(null);
      if (reason === 'kicked') setScreen({ name: 'kicked', code });
      else home(reason === 'gone' ? t('exit.gone') : undefined);
    },
    [home, setScreen],
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
          onAchievements={() => setScreen({ name: 'achievements' })}
          onProfile={() => setScreen({ name: 'profile' })}
        />
      );
    case 'kicked':
      return <KickedScreen code={screen.code} onHome={() => home()} onCreate={() => setScreen({ name: 'create' })} />;
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
      return (
        <ShopScreen
          key={screen.tab}
          initialTab={screen.tab}
          onBack={() => home()}
          onCollection={() => setScreen({ name: 'collection', tab: screen.tab })}
          onAchievements={() => setScreen({ name: 'achievements' })}
        />
      );
    case 'collection':
      return (
        <CollectionScreen
          key={screen.tab}
          initialTab={screen.tab}
          onBack={() => home()}
          onShop={(tab) => setScreen({ name: 'shop', tab })}
          onAchievements={() => setScreen({ name: 'achievements' })}
        />
      );
    case 'achievements':
      return <AchievementsScreen onBack={() => home()} />;
    case 'profile':
      return (
        <ProfileScreen
          onBack={() => home()}
          onCollection={(tab) => setScreen({ name: 'collection', tab })}
          onAchievements={() => setScreen({ name: 'achievements' })}
          onSettings={() => setScreen({ name: 'settings' })}
        />
      );
  }
}
