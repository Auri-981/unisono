import { useState, type FormEvent } from 'react';
import { DEFAULT_CONFIG, NAME_MAX_LENGTH } from '../../config/gameConfig';
import { cleanName } from '../../game/engine';
import type { RoomSnapshot } from '../../game/types';
import { errorMessage, t } from '../../i18n';
import { api, ApiError } from '../../net/api';
import { Page } from '../components/Layout';
import { getPrefs, setPrefs } from '../prefs';

interface Props {
  mode: 'create' | 'join';
  initialCode?: string;
  onBack: () => void;
  onEntered: (snapshot: RoomSnapshot) => void;
}

export function EntryScreen({ mode, initialCode = '', onBack, onEntered }: Props) {
  const [name, setName] = useState(getPrefs().name);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const clean = cleanName(name);
    if (!clean) {
      setError(errorMessage('INVALID_NAME'));
      return;
    }
    const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (mode === 'join' && cleanCode.length !== 5) {
      setError(errorMessage('ROOM_NOT_FOUND'));
      return;
    }
    setBusy(true);
    setError(null);
    setPrefs({ name: clean });
    try {
      const snap = mode === 'create' ? await api.createRoom(clean, DEFAULT_CONFIG) : await api.joinRoom(cleanCode, clean);
      onEntered(snap);
    } catch (err) {
      setError(errorMessage(err instanceof ApiError ? err.code : 'NETWORK'));
      setBusy(false);
    }
  };

  return (
    <Page title={t(mode === 'create' ? 'entry.createTitle' : 'entry.joinTitle')} onBack={onBack}>
      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span className="field-label">{t('entry.name')}</span>
          <input
            className="input input-large"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('entry.namePlaceholder')}
            maxLength={NAME_MAX_LENGTH + 5}
            autoComplete="nickname"
            autoCapitalize="words"
            enterKeyHint={mode === 'create' ? 'done' : 'next'}
            autoFocus={!name}
          />
        </label>
        {mode === 'join' && (
          <label className="field">
            <span className="field-label">{t('entry.code')}</span>
            <input
              className="input input-large input-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t('entry.codePlaceholder')}
              maxLength={8}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              autoFocus={Boolean(name) && !initialCode}
            />
          </label>
        )}
        {error && (
          <p className="notice notice-danger" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-large" disabled={busy}>
          {busy ? t('entry.connecting') : t(mode === 'create' ? 'entry.createSubmit' : 'entry.joinSubmit')}
        </button>
        <p className="muted small">{t('entry.privacy')}</p>
      </form>
    </Page>
  );
}
