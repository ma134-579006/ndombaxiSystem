import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { GATEWAY_PROVIDERS, type CreateGatewayInput, type Gateway } from '../api/types';
import { IconCard, IconPlus, IconTrash } from '../components/Icons';
import { Modal, Switch } from '../components/ui';

interface GatewayForm {
  id?: string;
  provider: string;
  label: string;
  contractRef: string;
  merchantId: string;
  posId: string;
  iban: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
}
const emptyForm = (): GatewayForm => ({
  provider: 'EXPRESS', label: '', contractRef: '', merchantId: '', posId: '', iban: '', baseUrl: '', apiKey: '', isActive: true,
});

export function Gateways() {
  const [items, setItems] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GatewayForm | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await api.gateways.list());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar os gateways.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const openEdit = (g: Gateway) =>
    setForm({
      id: g.id, provider: g.provider, label: g.label, contractRef: g.contractRef ?? '', merchantId: g.merchantId ?? '',
      posId: g.posId ?? '', iban: g.iban ?? '', baseUrl: g.baseUrl ?? '', apiKey: '', isActive: g.isActive,
    });

  const save = async () => {
    if (!form) return;
    if (!form.label.trim()) { alert('Indique um rótulo para o contrato.'); return; }
    setSaving(true);
    try {
      const dto: Partial<CreateGatewayInput> = {
        provider: form.provider, label: form.label.trim(),
        contractRef: form.contractRef.trim() || undefined, merchantId: form.merchantId.trim() || undefined,
        posId: form.posId.trim() || undefined, iban: form.iban.trim() || undefined, baseUrl: form.baseUrl.trim() || undefined,
        isActive: form.isActive,
      };
      if (form.apiKey.trim()) dto.apiKey = form.apiKey.trim();
      if (form.id) await api.gateways.update(form.id, dto);
      else await api.gateways.create(dto as CreateGatewayInput);
      setForm(null);
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Não foi possível guardar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: Gateway) => {
    if (!window.confirm(`Remover o contrato "${g.label}"?`)) return;
    try {
      await api.gateways.remove(g.id);
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Não foi possível remover.');
    }
  };

  if (loading) return <div className="loading">A carregar os gateways…</div>;

  return (
    <>
      {error ? <div className="banner danger">{error}</div> : null}
      <div className="content-head">
        <h2>Contratos de gateway</h2>
        <span className="muted" style={{ fontSize: 13 }}>Ex.: Multicaixa Express com IBAN e credenciais (encriptadas)</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setForm(emptyForm())}><IconPlus size={16} /> Adicionar contrato</button>
      </div>

      <div className="card">
        {items.length === 0 ? (
          <div className="empty"><IconCard size={40} /><p>Nenhum contrato configurado.</p></div>
        ) : (
          items.map((g) => (
            <div className="list-row" key={g.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {g.label} <span className="muted" style={{ fontWeight: 500 }}>· {g.provider}</span>
                  {!g.isActive ? <span className="muted"> · inactivo</span> : null}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                  {g.iban ? `IBAN ${g.iban}` : 'Sem IBAN'}
                  {g.contractRef ? ` · contrato ${g.contractRef}` : ''}
                  {g.apiKeyMask ? ` · chave ${g.apiKeyMask}` : ''}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => openEdit(g)}>Editar</button>
              <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => remove(g)}><IconTrash size={16} /></button>
            </div>
          ))
        )}
      </div>

      {form ? (
        <Modal title={form.id ? 'Editar contrato' : 'Novo contrato de gateway'} onClose={() => setForm(null)}>
          <div className="field">
            <label>Provedor</label>
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {GATEWAY_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field"><label>Rótulo</label><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex.: Multicaixa Express 2026" /></div>
          <div className="grid-2">
            <div className="field"><label>Referência do contrato</label><input value={form.contractRef} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} /></div>
            <div className="field"><label>Merchant ID</label><input value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })} /></div>
          </div>
          <div className="grid-2">
            <div className="field"><label>POS / Terminal</label><input value={form.posId} onChange={(e) => setForm({ ...form, posId: e.target.value })} /></div>
            <div className="field"><label>IBAN</label><input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="AO06…" /></div>
          </div>
          <div className="field"><label>URL base da API</label><input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></div>
          <div className="field"><label>Credencial/segredo {form.id ? '(deixe vazio para manter)' : ''}</label><input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.id ? '••••••••' : ''} /></div>
          <div className="switch-row"><span>Activo</span><Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} /></div>
          <button className="btn block lg" style={{ marginTop: 12 }} onClick={save} disabled={saving}>{saving ? 'A guardar…' : 'Guardar contrato'}</button>
        </Modal>
      ) : null}
    </>
  );
}
