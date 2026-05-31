import React, { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Customer } from '../api/types';
import { IconClose, IconSearch, IconUser } from './Icons';
import { KeyboardInput } from '../keyboard/KeyboardInput';

interface Props {
  customers: Customer[];
  onPick(customer: Customer | null): void;
  onCreated(customer: Customer): void;
  onClose(): void;
}

/** Selector de cliente: consumidor final, escolher existente ou criar rápido. */
export function CustomerModal({ customers, onPick, onCreated, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [nif, setNif] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.tax_id ?? '').toLowerCase().includes(q),
    );
  }, [customers, search]);

  const create = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Indique o nome do cliente.');
      return;
    }
    setCreating(true);
    try {
      const c = await api.createCustomer({ name: name.trim(), taxId: nif.trim() || undefined });
      onCreated(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível criar o cliente.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="row" style={{ padding: 16, borderBottom: '1px solid var(--border)', gap: 10 }}>
          <IconUser size={20} />
          <h2 style={{ margin: 0, fontSize: 18 }}>Cliente</h2>
          <span className="spacer" />
          <button className="trash" onClick={onClose} aria-label="Fechar">
            <IconClose size={22} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          <button className="btn ghost block" onClick={() => onPick(null)}>
            Consumidor final (sem cliente)
          </button>

          <KeyboardInput
            icon={<IconSearch size={18} />}
            placeholder="Procurar por nome ou NIF…"
            value={search}
            onChange={setSearch}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.length === 0 ? (
              <p className="muted" style={{ textAlign: 'center', padding: 8 }}>
                Sem clientes correspondentes.
              </p>
            ) : (
              filtered.slice(0, 30).map((c) => (
                <button
                  key={c.id}
                  className="cart-line"
                  style={{ textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }}
                  onClick={() => onPick(c)}
                >
                  <div className="cl-name">{c.name}</div>
                  <div className="cl-sub">{c.tax_id ? `NIF ${c.tax_id}` : 'Sem NIF'}</div>
                </button>
              ))
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ fontSize: 14 }}>Novo cliente</strong>
            {error ? <div className="banner danger">{error}</div> : null}
            <KeyboardInput label="Nome" placeholder="Nome do cliente" value={name} onChange={setName} />
            <KeyboardInput label="NIF (opcional)" placeholder="NIF" value={nif} onChange={setNif} numeric />
            <button className="btn block" onClick={create} disabled={creating}>
              {creating ? 'A criar…' : 'Adicionar cliente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
