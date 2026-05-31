import React from 'react';
import { copyrightLine } from '../brand';

/** Assinatura/direitos de autor — presente em todo o sistema. */
export function FooterCredit({ compact }: { compact?: boolean }) {
  return <p className={`footer-credit${compact ? ' compact' : ''}`}>{copyrightLine()}</p>;
}
