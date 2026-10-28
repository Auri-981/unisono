import { Fragment, type ReactNode } from 'react';

/** Convierte los **trozos en negrita** de un texto traducido en <strong>. */
export function rich(text: string): ReactNode {
  return text.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}
