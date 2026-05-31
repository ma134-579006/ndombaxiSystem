import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { AI_ADAPTERS, AI_CAPABILITIES, type AiProvider, type AssistantConfig, type CreateProviderInput } from '../api/types';
import { IconCpu, IconPlay, IconPlus, IconStar, IconTrash } from '../components/Icons';
import { Modal, Switch } from '../components/ui';

interface ProviderForm {
  id?: string;
  name: string;
  adapter: string;
  capabilities: string[];
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  priority: string;
  isActive: boolean;
  isDefault: boolean;
}
const emptyForm = (): ProviderForm => ({
  name: '', adapter: 'openmanus', capabilities: ['CHAT'], baseUrl: '', apiKey: '',
  model: '', voice: '', priority: '100', isActive: true, isDefault: false,
});

export function Ai() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [assistant, setAssistant] = useState<AssistantConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingA, setSavingA] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([api.ai.listProviders(), api.ai.getAssistant().catch(() => null)]);
      setProviders(p);
      setAssistant(a);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar a IA.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openCreate = () => setForm(emptyForm());
  const openEdit = (p: AiProvider) =>
    setForm({
      id: p.id, name: p.name, adapter: p.adapter, capabilities: [...p.capabilities], baseUrl: p.baseUrl,
      apiKey: '', model: p.model ?? '', voice: p.voice ?? '', priority: String(p.priority),
      isActive: p.isActive, isDefault: p.isDefault,
    });

  const toggleCap = (c: string) =>
    setForm((f) => (f ? { ...f, capabilities: f.capabilities.includes(c) ? f.capabilities.filter((x) => x !== c) : [...f.capabilities, c] } : f));

  const saveProvider = async () => {
    if (!form) return;
    if (!form.name.trim() || !form.baseUrl.trim() || form.capabilities.length === 0) {
      alert('Indique nome, URL base e pelo menos uma capacidade.');
      return;
    }
    setSaving(true);
    try {
      const dto: Partial<CreateProviderInput> = {
        name: form.name.trim(), adapter: form.adapter, capabilities: form.capabilities, baseUrl: form.baseUrl.trim(),
        model: form.model.trim() || undefined, voice: form.voice.trim() || undefined,
        priority: Number(form.priority) || 100, isActive: form.isActive, isDefault: form.isDefault,
      };
      if (form.apiKey.trim()) dto.apiKey = form.apiKey.trim();
      if (form.id) await api.ai.updateProvider(form.id, dto);
      else await api.ai.createProvider(dto as CreateProviderInput);
      setForm(null);
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Não foi possível guardar o provedor.');
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async (p: AiProvider) => {
    if (!window.confirm(`Remover o provedor "${p.name}"?`)) return;
    try {
      await api.ai.deleteProvider(p.id);
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Não foi possível remover.');
    }
  };

  const testProvider = async (p: AiProvider) => {
    try {
      const r = await api.ai.testProvider(p.id);
      alert(r.ok ? `✓ ${p.name} respondeu.` : `Resposta: ${JSON.stringify(r)}`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Teste falhou.');
    }
  };

  const saveAssistant = async () => {
    if (!assistant) return;
    setSavingA(true);
    try {
      setAssistant(await api.ai.updateAssistant(assistant));
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Não foi possível guardar a persona.');
    } finally {
      setSavingA(false);
    }
  };
  const setA = <K extends keyof AssistantConfig>(k: K, v: AssistantConfig[K]) =>
    setAssistant((a) => (a ? ({ ...a, [k]: v } as AssistantConfig) : a));

  if (loading) return <div className="loading">A carregar a configuração de IA…</div>;

  return (
    <>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="content-head">
        <h2>Provedores de IA</h2>
        <span className="muted" style={{ fontSize: 13 }}>OpenManus, OpenAI, Anthropic, ElevenLabs ou REST genérico</span>
        <span className="spacer" />
        <button className="btn sm" onClick={openCreate}><IconPlus size={16} /> Adicionar provedor</button>
      </div>

      <div className="card">
        {providers.length === 0 ? (
          <div className="empty"><IconCpu size={40} /><p>Nenhum provedor configurado.</p></div>
        ) : (
          providers.map((p) => (
            <div className="list-row" key={p.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {p.name}{' '}
                  {p.isDefault ? <span className="badge" style={{ color: 'var(--primary)', borderColor: 'var(--primary)' }}><IconStar size={11} /> default</span> : null}
                  {!p.isActive ? <span className="muted"> · inactivo</span> : null}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                  {p.adapter} · {p.capabilities.join(', ')} · {p.baseUrl}
                  {p.hasApiKey ? ` · chave ${p.apiKeyMask ?? '••••'}` : ' · sem chave'}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => testProvider(p)}><IconPlay size={15} /> Testar</button>
              <button className="btn sm ghost" onClick={() => openEdit(p)}>Editar</button>
              <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => removeProvider(p)}><IconTrash size={16} /></button>
            </div>
          ))
        )}
      </div>

      {/* Persona do assistente */}
      {assistant ? (
        <div className="card">
          <h3>Assistente — persona &amp; canais</h3>
          <div className="grid-2">
            <div className="field"><label>Nome do assistente</label><input value={assistant.displayName} onChange={(e) => setA('displayName', e.target.value)} /></div>
            <div className="field"><label>Idioma (locale)</label><input value={assistant.locale} onChange={(e) => setA('locale', e.target.value)} /></div>
          </div>
          <div className="field"><label>Personalidade</label><textarea value={assistant.persona} onChange={(e) => setA('persona', e.target.value)} /></div>
          <div className="field"><label>Saudação inicial</label><input value={assistant.greeting ?? ''} onChange={(e) => setA('greeting', e.target.value)} placeholder="Olá! Como posso ajudar?" /></div>
          <div className="field">
            <label>Nível de emojis</label>
            <select value={assistant.emojiLevel} onChange={(e) => setA('emojiLevel', e.target.value)}>
              {['none', 'subtle', 'balanced', 'rich'].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="switch-row"><span>Voz (TTS)</span><Switch checked={assistant.voiceEnabled} onChange={(v) => setA('voiceEnabled', v)} /></div>
          <div className="switch-row"><span>Chamadas de voz</span><Switch checked={assistant.callEnabled} onChange={(v) => setA('callEnabled', v)} /></div>
          <div className="switch-row"><span>Geração de imagens</span><Switch checked={assistant.imageEnabled} onChange={(v) => setA('imageEnabled', v)} /></div>
          <div className="switch-row"><span>Gráficos nas respostas</span><Switch checked={assistant.chartsEnabled} onChange={(v) => setA('chartsEnabled', v)} /></div>
          <button className="btn" style={{ marginTop: 12 }} onClick={saveAssistant} disabled={savingA}>{savingA ? 'A guardar…' : 'Guardar persona'}</button>
        </div>
      ) : null}

      {form ? (
        <Modal title={form.id ? 'Editar provedor' : 'Novo provedor de IA'} onClose={() => setForm(null)}>
          <div className="field"><label>Nome</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: OpenManus Produção" /></div>
          <div className="field">
            <label>Adaptador</label>
            <select value={form.adapter} onChange={(e) => setForm({ ...form, adapter: e.target.value })}>
              {AI_ADAPTERS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Capacidades</label>
          <div className="cap-grid" style={{ marginTop: 6 }}>
            {AI_CAPABILITIES.map((c) => (
              <button key={c} className={`chip${form.capabilities.includes(c) ? ' active' : ''}`} onClick={() => toggleCap(c)}>{c}</button>
            ))}
          </div>
          <div className="field"><label>URL base</label><input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openmanus.ai/v1" /></div>
          <div className="field"><label>Chave da API {form.id ? '(deixe vazio para manter)' : '(opcional)'}</label><input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.id ? '••••••••' : 'sk-…'} /></div>
          <div className="grid-2">
            <div className="field"><label>Modelo</label><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="gpt-4o-mini" /></div>
            <div className="field"><label>Prioridade</label><input value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} inputMode="numeric" /></div>
          </div>
          <div className="field"><label>Voz (TTS)</label><input value={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.value })} placeholder="ex.: nova" /></div>
          <div className="switch-row"><span>Activo</span><Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} /></div>
          <div className="switch-row"><span>Provedor por omissão</span><Switch checked={form.isDefault} onChange={(v) => setForm({ ...form, isDefault: v })} /></div>
          <button className="btn block lg" style={{ marginTop: 12 }} onClick={saveProvider} disabled={saving}>{saving ? 'A guardar…' : 'Guardar provedor'}</button>
        </Modal>
      ) : null}
    </>
  );
}
