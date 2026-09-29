import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PayStep } from './CompanySetup';
import { PendingApproval } from './PendingApproval';
import { IconLogout, IconCard } from '../components/Icons';
import { LoginShowcase } from '../components/LoginShowcase';

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
    <div className="auth pe">
      <div className="auth-panel">
        <div className="auth-form pe-form">
          <div className="pe-badge"><IconCard size={26} /></div>
          <span className="pe-chip">Acesso suspenso</span>
          <h1 className="auth-title">Plano expirado</h1>
          <p className="pe-sub">Renove para voltar a aceder ao seu negócio.</p>
          {step === 'notice' ? (
            <div className="pe-card">
              <div className="banner danger">
                <div>O período do seu plano terminou e o acesso está <strong>bloqueado</strong>. Os seus dados estão guardados em segurança.</div>
              </div>
              <p className="pe-text">
                Para reativar, faça o pagamento da renovação e envie o comprovativo. Após a aprovação do administrador, entra novamente com tudo como estava.
              </p>
              <button className="auth-btn" onClick={() => setStep('pay')}>
                <IconCard size={18} /> Ativar / Renovar plano
              </button>
            </div>
          ) : (
            <div className="pe-card"><PayStep onNext={() => setStep('waiting')} allowPlanChoice /></div>
          )}
          <p className="auth-foot">
            <a onClick={() => void logout()} className="pe-out"><IconLogout size={15} /> Terminar sessão</a>
          </p>
        </div>
      </div>
      <div className="auth-media"><LoginShowcase /></div>
    </div>
  );
}
