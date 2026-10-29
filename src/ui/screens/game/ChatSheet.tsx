import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH, hasNumber } from '../../../config/gameConfig';
import type { RoomController } from '../../../game/controller';
import { t } from '../../../i18n';

export function ChatSheet({ ctl, onClose }: { ctl: RoomController; onClose: () => void }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const me = ctl.snapshot?.me;
  // Con números no se puede enviar (el servidor también lo rechaza).
  const withNumbers = hasNumber(text);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [ctl.chat.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || withNumbers) return;
    setText('');
    await ctl.actions.sendChat(body);
  };

  return (
    <div className="sheet" role="dialog" aria-label={t('game.chat')}>
      <div className="sheet-head">
        <strong>{t('game.chat')}</strong>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
      <div className="chat-list" ref={listRef}>
        {ctl.chat.map((m) => (
          <p key={m.id} className={`chat-msg ${m.userId === me ? 'chat-mine' : ''}`}>
            <span className="chat-name">{m.name}</span>
            <span>{m.body}</span>
          </p>
        ))}
      </div>
      {withNumbers && (
        <p className="chat-warning" id="chat-warning" role="alert">
          {t('game.chatNoNumbers')}
        </p>
      )}
      <form className="chat-form" onSubmit={send}>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={t('game.chatPlaceholder')}
          enterKeyHint="send"
          aria-invalid={withNumbers}
          aria-describedby={withNumbers ? 'chat-warning' : undefined}
        />
        <button type="submit" className="btn btn-primary" disabled={withNumbers || !text.trim()}>
          {t('game.send')}
        </button>
      </form>
    </div>
  );
}
