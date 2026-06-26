import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PayStep } from './CompanySetup';
import { PendingApproval } from './PendingApproval';
import { IconLogout, IconCard } from '../components/Icons';

/**
 * Plano EXPIRADO: o sistema bloqueia o acesso geral. A empresa vê uma
 * notificação com um botão de ativação que abre o pagamento (renovação) →
 * envia o comprovativo → aguarda a aprovação do Super Admin → volta a entrar
 * com todos os dados preservados.
 */
export function PlanExpired({ onResolved }: { onResolved(): void }) {
  const { logout } = useAuth();
  const [step, setStep] = useState<'notice' | 'pay' | 'waiting'>('notice');

  if (step === 'waiting') {
    return (
      <PendingApproval
        onApproved={onResolved}
        title="Renovação em aprovação"
        subtitle="O administrador está a validar o seu pagamento de renovação"
        intro={<>Comprovativo de renovação enviado. Assim que o <strong>Super Admin</strong> aprovar, o acesso é restabelecido com todos os seus dados.</>}
      />
    );
  }

  return (
    <div className="login">
      <div className="box" style={{ maxWidth: 480 }}>
        <div className="brand">
          <div style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 10 }}>
            <IconCard size={26} />
          </div>
          <h1>Plano expirado</h1>
          <div className="tg">Renove para voltar a aceder</div>
        </div>
        {step === 'notice' ? (
          <div className="card">
            <div className="banner danger" style={{ marginBottom: 12 }}>
              O período do seu plano terminou e o acesso está <strong>bloqueado</strong>. Os seus dados estão guardados em segurança.
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Para reativar, faça o pagamento da renovação e envie o comprovativo. Após a aprovação do administrador, entra novamente com tudo como estava.
            </p>
            <button className="btn lg block" onClick={() => setStep('pay')}>
              <IconCard size={18} /> Ativar / Renovar plano
            </button>
          </div>
        ) : (
          <PayStep onNext={() => setStep('waiting')} allowPlanChoice />
        )}
        <p style={{ textAlign: 'center', marginTop: 12 }}>
          <a onClick={() => void logout()} style={{ color: 'var(--muted)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconLogout size={15} /> Terminar sessão
          </a>
        </p>
      </div>
    </div>
  );
}
