import type { ExitReason, RoomController } from '../../game/controller';
import type { RoomConfig, RoomSnapshot } from '../../game/types';
import { t } from '../../i18n';
import { useOnlineRoom } from '../../net/useOnlineRoom';
import { usePracticeRoom } from '../../practice/usePracticeRoom';
import { GameScreen } from './game/GameScreen';
import { LobbyScreen } from './LobbyScreen';

function RoomView({ ctl, onExit }: { ctl: RoomController; onExit: () => void }) {
  if (!ctl.snapshot) {
    return (
      <div className="center-screen">
        <p className="muted">{t('common.loading')}</p>
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          {t('common.back')}
        </button>
      </div>
    );
  }
  return ctl.snapshot.room.status === 'lobby' ? <LobbyScreen ctl={ctl} /> : <GameScreen ctl={ctl} onExit={onExit} />;
}

export function OnlineRoom({
  roomId,
  initial,
  onExit,
}: {
  roomId: string;
  initial: RoomSnapshot | null;
  onExit: (reason: ExitReason) => void;
}) {
  const ctl = useOnlineRoom(roomId, initial, onExit);
  return <RoomView ctl={ctl} onExit={() => void ctl.actions.leave()} />;
}

export function PracticeRoom({
  bots,
  config,
  myName,
  onExit,
}: {
  bots: number;
  config: RoomConfig;
  myName: string;
  onExit: (reason: ExitReason) => void;
}) {
  const ctl = usePracticeRoom({ bots, config, myName }, onExit);
  return <RoomView ctl={ctl} onExit={() => onExit('left')} />;
}
