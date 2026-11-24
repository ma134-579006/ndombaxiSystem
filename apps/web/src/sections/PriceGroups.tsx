import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ManagerProduct } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { formatKz } from '../format';

type Group = { id: string; name: string; customers: number; prices: number };

/**
 * GRUPOS DE PREÇO (como no Vendus — Configurações → Grupos de Preços): cada grupo
 * tem preços próprios por produto (sem IVA, como o preço do produto). O cliente
 * escolhe-se o grupo na ficha do cliente; a venda usa o preço do grupo.
 */
export function PriceGroupsCard() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Group | null>(null);

  const load = async () => {
    try { setGroups(await api.priceGroups.list()); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao carregar os grupos.'); setGroups([]); }
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    const n = name.trim();
    if (!n) { toast.warning('Indica o nome do grupo.'); return; }
    setBusy(true);
    try { await api.priceGroups.create(n); setName(''); toast.success(`Grupo «${n}» criado.`); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível criar o grupo.'); }
    finally { setBusy(false); }
  };

  const rename = async (g: Group) => {
    const n = window.prompt('Novo nome do grupo', g.name)?.trim();
    if (!n || n === g.name) return;
    try { await api.priceGroups.rename(g.id, n); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível renomear.'); }
  };

  const remove = async (g: Group) => {
    const ok = await confirmDialog({ title: `Apagar o grupo «${g.name}»?`, message: g.customers ? `${g.customers} cliente(s) ficam sem grupo e voltam ao preço normal.` : 'Os preços deste grupo são apagados.', confirmLabel: 'Apagar', danger: true });
    if (!ok) return;
    try { await api.priceGroups.remove(g.id); toast.success('Grupo apagado.'); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível apagar.'); }
  };

  if (open) return <GroupPrices group={open} onBack={() => { setOpen(null); void load(); }} />;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Grupos de Preço</h3>
      <p className="muted" style={{ marginTop: 0 }}>Preços próprios por produto para grupos de clientes (revendedores, funcionários…). Atribui o grupo na ficha do cliente; a venda usa o preço do grupo.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do grupo" maxLength={80} style={{ flex: '1 1 220px' }}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <button className="btn" onClick={() => void add()} disabled={busy}>Adicionar Grupo</button>
      </div>
      {groups === null ? <p className="muted">A carregar…</p> : groups.length === 0 ? <p className="muted">Ainda não há grupos de preço.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nome</th><th>Clientes</th><th>Preços</th><th /></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td><b>{g.name}</b></td>
                  <td>{g.customers}</td>
                  <td>{g.prices}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setOpen(g)}>Preços</button>{' '}
                    <button className="btn sm ghost" onClick={() => void rename(g)}>Editar</button>{' '}
                    <button className="btn sm ghost danger" onClick={() => void remove(g)}>Apagar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Tabela de preços de UM grupo: todos os produtos, com o preço normal e o do grupo. */
function GroupPrices({ group, onBack }: { group: Group; onBack(): void }) {
  const [products, setProducts] = useState<ManagerProduct[] | null>(null);
  const [orig, setOrig] = useState<Map<string, number>>(new Map());
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [ps, pr] = await Promise.all([api.products.list({ limit: 5000 }), api.priceGroups.prices(group.id)]);
        setProducts(ps.filter((p) => p.is_active !== false && !(p as { is_ingredient?: boolean }).is_ingredient));
        const m = new Map(pr.map((r) => [r.product_id, Number(r.unit_price)]));
        setOrig(m);
        setEdit(Object.fromEntries([...m].map(([k, v]) => [k, String(v)])));
      } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao carregar os preços.'); setProducts([]); }
    })();
  }, [group.id]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (products ?? []).filter((p) => !t || p.name.toLowerCase().includes(t) || p.code.toLowerCase().includes(t)).slice(0, 300);
  }, [products, q]);

  const changes = useMemo(() => {
    const out: { productId: string; unitPrice: number | null }[] = [];
    const ids = new Set([...orig.keys(), ...Object.keys(edit)]);
    for (const id of ids) {
      const raw = (edit[id] ?? '').replace(',', '.').trim();
      const next = raw === '' ? null : Number(raw);
      if (next !== null && !(next >= 0)) continue;
      const before = orig.get(id) ?? null;
      if (next !== before) out.push({ productId: id, unitPrice: next });
    }
    return out;
  }, [edit, orig]);

  const save = async () => {
    if (!changes.length) { onBack(); return; }
    setSaving(true);
    try {
      await api.priceGroups.setPrices(group.id, changes);
      toast.success(`Preços do grupo «${group.name}» guardados (${changes.length}).`);
      onBack();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn sm ghost" onClick={onBack}>← Grupos</button>
        <h3 style={{ margin: 0, flex: 1 }}>Preços — {group.name}</h3>
        <button className="btn" onClick={() => void save()} disabled={saving}>{saving ? 'A guardar…' : `Gravar${changes.length ? ` (${changes.length})` : ''}`}</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Preço sem IVA. Deixa vazio para usar o preço normal do produto.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar produto (nome ou referência)" style={{ width: '100%', marginBottom: 10 }} />
      {products === null ? <p className="muted">A carregar…</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ref</th><th>Produto</th><th>Preço normal</th><th>Preço do grupo</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>{formatKz(Number(p.unit_price))}</td>
                  <td>
                    <input inputMode="decimal" value={edit[p.id] ?? ''} placeholder="—" style={{ maxWidth: 140 }}
                      onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} aria-label={`Preço do grupo para ${p.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(products?.length ?? 0) > shown.length ? <p className="muted">A mostrar {shown.length} — pesquisa para encontrar outros.</p> : null}
        </div>
      )}
    </div>
  );
}
