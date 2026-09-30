import { confirmDialog, toast } from '../components/feedback';
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
  const [aiTab, setAiTab] = useState<'providers' | 'assistant'>('providers');
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
      toast.error('Indique nome, URL base e pelo menos uma capacidade.');
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
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar o provedor.');
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async (p: AiProvider) => {
    if (!(await confirmDialog({ message: `Remover o provedor "${p.name}"?`, danger: true }))) return;
    try {
      await api.ai.deleteProvider(p.id);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível remover.');
    }
  };

  const testProvider = async (p: AiProvider) => {
    try {
      const r = await api.ai.testProvider(p.id);
      toast.error(r.ok ? `✓ ${p.name} respondeu.` : `Resposta: ${JSON.stringify(r)}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Teste falhou.');
    }
  };

  const saveAssistant = async () => {
    if (!assistant) return;
    setSavingA(true);
    try {
      setAssistant(await api.ai.updateAssistant(assistant));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar a persona.');
    } finally {
      setSavingA(false);
    }
  };
  const setA = <K extends keyof AssistantConfig>(k: K, v: AssistantConfig[K]) =>
    setAssistant((a) => (a ? ({ ...a, [k]: v } as AssistantConfig) : a));

  if (loading) return <div className="loading">A carregar a configuração de IA…</div>;

  const activeProviders = providers.filter((p) => p.isActive);
  const def = providers.find((p) => p.isDefault);
  const caps = new Set(providers.flatMap((p) => p.capabilities));
  const EMOJI_LABEL: Record<string, string> = { none: 'Nenhum', subtle: 'Discreto', balanced: 'Equilibrado', rich: 'Rico' };

  return (
    <div className="fx-wide">
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="content-head">
        <h2>Inteligência Artificial</h2>
        <span className="spacer" />
        {aiTab === 'providers' ? <button className="btn" onClick={openCreate}><IconPlus size={16} /> Adicionar provedor</button> : null}
      </div>

      <div className="fx-stats">
        <div className="fx-stat"><span className="ic"><IconCpu size={20} /></span><div><div className="lb">Provedores</div><div className="vl">{providers.length}</div><div className="sb">{activeProviders.length} activo(s)</div></div></div>
        <div className="fx-stat"><span className="ic"><IconStar size={20} /></span><div><div className="lb">Por omissão</div><div className="vl">{def ? def.name : '—'}</div><div className="sb">{def ? def.adapter : 'define um provedor principal'}</div></div></div>
        <div className="fx-stat"><span className="ic"><IconCpu size={20} /></span><div><div className="lb">Capacidades</div><div className="vl">{caps.size}</div><div className="sb">{[...caps].slice(0, 4).join(', ') || 'nenhuma'}</div></div></div>
      </div>

      <div className="fx-tabs" role="tablist" aria-label="Inteligência artificial">
        <button role="tab" aria-selected={aiTab === 'providers'} className={aiTab === 'providers' ? 'on' : ''} onClick={() => setAiTab('providers')}>Provedores</button>
        <button role="tab" aria-selected={aiTab === 'assistant'} className={aiTab === 'assistant' ? 'on' : ''} onClick={() => setAiTab('assistant')}>Assistente e canais</button>
      </div>

      {aiTab === 'providers' ? (
        <div className="fx-card" style={{ padding: 8 }}>
          <div className="fx-card-h" style={{ padding: '12px 14px 0', marginBottom: 8 }}>
            <div><h3>Provedores</h3><p>OpenManus, OpenAI, Anthropic, ElevenLabs ou REST genérico. A chave da API fica cifrada e nunca é mostrada de volta.</p></div>
          </div>
          {providers.length === 0 ? (
            <div className="empty"><IconCpu size={40} /><p>Nenhum provedor configurado.</p></div>
          ) : (
            providers.map((p) => (
              <div className="co-row" key={p.id}>
                <span className="co-av" aria-hidden="true"><IconCpu size={18} /></span>
                <div className="co-main">
                  <div className="co-name">
                    {p.name}
                    {p.isDefault ? <span className="fx-badge ok" style={{ marginLeft: 8, padding: '1px 9px', fontSize: 11 }}>Por omissão</span> : null}
                    {!p.isActive ? <span className="fx-badge" style={{ marginLeft: 8, padding: '1px 9px', fontSize: 11 }}>Inactivo</span> : null}
                  </div>
                  <div className="co-meta">
                    <span className="co-plan">{p.adapter}</span>
                    <span>{p.capabilities.join(', ') || 'sem capacidades'}</span>
                    <span className="mono">{p.baseUrl}</span>
                    <span>{p.hasApiKey ? `chave ${p.apiKeyMask ?? '••••'}` : 'sem chave'}</span>
                  </div>
                </div>
                <div className="co-actions">
                  <button className="btn sm ghost" onClick={() => testProvider(p)}><IconPlay size={15} /> Testar</button>
                  <button className="btn sm ghost" onClick={() => openEdit(p)}>Editar</button>
                  <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => removeProvider(p)} aria-label={`Remover ${p.name}`}><IconTrash size={16} /></button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {aiTab === 'assistant' && assistant ? (
        <div className="fx-card">
          <div className="fx-card-h">
            <div><h3>Persona do assistente</h3><p>Como o assistente se apresenta e que canais tem activos.</p></div>
          </div>
          <div className="fx-grid">
            <div className="field"><label>Nome do assistente</label><input value={assistant.displayName} onChange={(e) => setA('displayName', e.target.value)} /></div>
            <div className="field"><label>Idioma</label><input value={assistant.locale} onChange={(e) => setA('locale', e.target.value)} /></div>
            <div className="field">
              <label>Nível de emojis</label>
              <select value={assistant.emojiLevel} onChange={(e) => setA('emojiLevel', e.target.value)}>
                {['none', 'subtle', 'balanced', 'rich'].map((o) => <option key={o} value={o}>{EMOJI_LABEL[o]}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Personalidade</label><textarea value={assistant.persona} onChange={(e) => setA('persona', e.target.value)} /></div>
          <div className="field"><label>Saudação inicial</label><input value={assistant.greeting ?? ''} onChange={(e) => setA('greeting', e.target.value)} placeholder="Olá! Como posso ajudar?" /></div>
          <div className="switch-row"><span>Voz (TTS)</span><Switch checked={assistant.voiceEnabled} onChange={(v) => setA('voiceEnabled', v)} /></div>
          <div className="switch-row"><span>Chamadas de voz</span><Switch checked={assistant.callEnabled} onChange={(v) => setA('callEnabled', v)} /></div>
          <div className="switch-row"><span>Geração de imagens</span><Switch checked={assistant.imageEnabled} onChange={(v) => setA('imageEnabled', v)} /></div>
          <div className="switch-row"><span>Gráficos nas respostas</span><Switch checked={assistant.chartsEnabled} onChange={(v) => setA('chartsEnabled', v)} /></div>
          <div className="fx-actions">
            <button className="btn" onClick={saveAssistant} disabled={savingA}>{savingA ? 'A guardar…' : 'Guardar persona'}</button>
          </div>
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
    </div>
  );
}
