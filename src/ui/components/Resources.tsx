import { t } from '../../i18n';
import type { ConnectionState } from '../../game/controller';
import { LifeIcon, VistazoIcon } from './Icons';

export function Lives({ count }: { count: number }) {
  return (
    <span className="resource resource-life" aria-label={`${t('common.lives')}: ${count}`} title={t('common.lives')}>
      <LifeIcon size={20} />
      <span className="resource-count" key={count}>
        {count}
      </span>
    </span>
  );
}

export function Vistazos({ count }: { count: number }) {
  return (
    <span className="resource resource-shuriken" aria-label={`${t('common.shurikens')}: ${count}`} title={t('common.shurikens')}>
      <VistazoIcon size={20} />
      <span className="resource-count" key={count}>
        {count}
      </span>
    </span>
  );
}

export function ConnectionDot({ state }: { state: ConnectionState }) {
  return (
    <span className={`conn conn-${state}`} role="status" aria-live="polite">
      <span className="conn-dot" aria-hidden />
      <span className="conn-label">{t(`conn.${state}`)}</span>
    </span>
  );
}
