import { es, type MessageKey } from './es';
import { isGameErrorCode } from '../game/types';

export type { MessageKey };

type Dictionary = Record<MessageKey, string>;

const dictionaries: Record<string, Dictionary> = { es };
let current: Dictionary = es;

export function setLanguage(lang: string) {
  current = dictionaries[lang] ?? es;
  document.documentElement.lang = dictionaries[lang] ? lang : 'es';
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = current[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** Convierte cualquier código de error en un mensaje comprensible. */
export function errorMessage(code: string | null | undefined): string {
  if (!code) return t('error.UNKNOWN');
  if (isGameErrorCode(code) || ['NETWORK', 'ANON_DISABLED', 'NOT_CONFIGURED'].includes(code)) {
    return t(`error.${code}` as MessageKey);
  }
  return t('error.UNKNOWN');
}
