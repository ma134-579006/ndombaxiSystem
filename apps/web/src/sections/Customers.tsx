import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CustomerRow } from '../api/types';
import { toast } from '../components/feedback';
import { IconPlus, IconSearch } from '../components/Icons';
import { Modal } from '../components/ui';

/**
 * CLIENTES da empresa: o gestor cadastra aqui e vê também os que o CAIXA
 * regista nas vendas (é a mesma base). Pesquisa, criação e contacto rápido.
 */
export function Customers() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', taxId: '', address: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.customers.list()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar clientes.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!form.name.trim()) { toast.warning('Indica o nome do cliente.'); return; }
    setSaving(true);
    try {
      await api.customers.create({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        taxId: form.taxId.trim() || undefined,
        address: form.address.trim() || undefined,
      });
      toast.success(`Cliente «${form.name.trim()}» criado.`);
      setCreating(false);
      setForm({ name: '', phone: '', email: '', taxId: '', address: '' });
      await load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível criar.'); }
    finally { setSaving(false); }
  };

  const filtered = q.trim()
    ? rows.filter((r) => `${r.name} ${r.phone ?? ''} ${r.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;

  return (
    <>
      <div className="content-head">
        <h2>Clientes <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>· {rows.length} registados</span></h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={17} /> Novo cliente</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card" style={{ padding: '2px 14px' }}>
        <div className="row">
          <IconSearch size={18} />
          <input
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '13px 0', color: 'var(--text)' }}
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar por nome, telefone ou email…"
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? <div className="loading" style={{ padding: 26 }}>A carregar…</div>
          : filtered.length === 0 ? <div className="empty" style={{ padding: 30 }}><p>{q ? 'Sem resultados.' : 'Ainda não há clientes — cria o primeiro ou regista-os no caixa durante a venda.'}</p></div>
          : filtered.map((c) => (
            <div key={c.id} className="list-row" style={{ padding: '12px 16px' }}>
              <span className="fb-avatar">{c.name.slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{c.name}</strong>
                <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.phone, c.email, c.tax_id ? `NIF ${c.tax_id}` : null].filter(Boolean).join(' · ') || 'sem contactos'}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {c.phone ? (
                  <a className="btn sm ghost" href={`https://wa.me/${c.phone.replace(/[^\d]/g, '').replace(/^(?!244)(\d{9})$/, '244$1')}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>
                ) : null}
                {c.phone ? <a className="btn sm ghost" href={`tel:${c.phone}`}>📞 Ligar</a> : null}
              </div>
            </div>
          ))}
      </div>

      {creating ? (
        <Modal title="Novo cliente" onClose={() => setCreating(false)}>
          <div className="field"><label>Nome</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do cliente" /></div>
          <div className="grid-2">
            <div className="field"><label>Telefone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+244 9xx xxx xxx" inputMode="tel" /></div>
            <div className="field"><label>NIF (opcional)</label>
              <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} placeholder="para factura com NIF" /></div>
          </div>
          <div className="field"><label>E-mail (opcional)</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="cliente@email.com" inputMode="email" /></div>
          <div className="field"><label>Morada (opcional)</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Rua, bairro, município" /></div>
          <button className="btn lg block" onClick={() => void save()} disabled={saving}>{saving ? 'A criar…' : 'Criar cliente'}</button>
        </Modal>
      ) : null}
    </>
  );
}
