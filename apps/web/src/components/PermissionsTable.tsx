import React from 'react';
import { STAFF_ROLE_LABELS, type StaffRoleName } from '../api/types';
import { Modal } from './ui';

/**
 * Tabela de Permissões (modelo "Perfis de Utilizadores" do backoffice de
 * referência): o que cada perfil do sistema pode abrir. Gerada a partir das
 * MESMAS regras do menu (nível mínimo por área), por isso nunca diverge do que
 * cada pessoa vê. Os perfis do sistema não se alteram.
 */
export interface PermArea { label: string; group?: string; min?: number }
const LEVEL: Record<StaffRoleName, number> = {
  COMPANY_ADMIN: 1, REGIONAL_MANAGER: 2, STORE_MANAGER: 3, SHIFT_SUPERVISOR: 4, CASHIER: 5, ATTENDANT: 6,
};
const COLS: StaffRoleName[] = ['COMPANY_ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'SHIFT_SUPERVISOR', 'CASHIER', 'ATTENDANT'];

export function PermissionsTable({ areas, onClose }: { areas: PermArea[]; onClose(): void }) {
  // Omisso = gerente de loja e acima (mesma regra do menu).
  const can = (role: StaffRoleName, a: PermArea) => LEVEL[role] <= (a.min ?? 3);
  let lastGroup = '';
  return (
    <Modal title="Tabela de Permissões" onClose={onClose} wide>
      <div className="vd-tablewrap">
        <table className="vd-table perm-table">
          <thead>
            <tr><th>Área</th>{COLS.map((r) => <th key={r} className="ctr">{STAFF_ROLE_LABELS[r]}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td><b>Caixa (POS)</b></td>{COLS.map((r) => <td key={r} className="ctr ok">✓</td>)}</tr>
            {areas.map((a) => {
              const head = a.group && a.group !== lastGroup ? a.group : '';
              lastGroup = a.group ?? lastGroup;
              return (
                <React.Fragment key={`${a.group ?? ''}-${a.label}`}>
                  {head ? <tr className="perm-group"><td colSpan={COLS.length + 1}>{head}</td></tr> : null}
                  <tr>
                    <td>{a.label}</td>
                    {COLS.map((r) => <td key={r} className={`ctr ${can(r, a) ? 'ok' : 'no'}`}>{can(r, a) ? '✓' : '—'}</td>)}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="perm-note">Perfis do sistema: Administrador, Gerente regional, Gerente de loja, Supervisor de turno, Operador de caixa e Atendente não podem ser alterados.</p>
    </Modal>
  );
}
