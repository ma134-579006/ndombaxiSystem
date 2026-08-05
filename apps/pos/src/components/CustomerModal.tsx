import React, { useMemo, useState } from 'react';
import { Button, Dialog, EmptyState } from '@nexus/ui';
import { api, ApiError } from '../api/client';
import type { Customer } from '../api/types';
import { IconSearch, IconUser } from './Icons';
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
    <Dialog open onClose={onClose} title="Cliente" size="sm">
      <Button variant="secondary" block onClick={() => onPick(null)}>
        Consumidor final (sem cliente)
      </Button>

      <KeyboardInput
        icon={<IconSearch size={18} />}
        placeholder="Procurar por nome ou NIF…"
        value={search}
        onChange={setSearch}
      />

      {/* O nº de resultados é anunciado: quem procura às cegas percebe que a
          lista mudou sem ter de a percorrer. */}
      <div className="nx-stack-2" role="listbox" aria-label="Clientes" aria-live="polite">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<IconUser size={26} />}
            title="Sem clientes correspondentes"
            text="Ajuste a procura ou crie o cliente aqui em baixo."
          />
        ) : (
          filtered.slice(0, 30).map((c) => (
            <button
              key={c.id}
              className="cart-line"
              role="option"
              aria-selected={false}
              style={{ textAlign: 'left', cursor: 'pointer', color: 'var(--nx-c-text)' }}
              onClick={() => onPick(c)}
            >
              <div className="cl-name">{c.name}</div>
              <div className="cl-sub">{c.tax_id ? `NIF ${c.tax_id}` : 'Sem NIF'}</div>
            </button>
          ))
        )}
      </div>

      <div
        className="nx-stack-2"
        style={{ borderTop: '1px solid var(--nx-c-border)', paddingTop: 'var(--nx-space-3)' }}
      >
        <strong className="nx-body-sm">Novo cliente</strong>
        {error ? (
          <div className="banner danger" role="alert">
            {error}
          </div>
        ) : null}
        <KeyboardInput label="Nome" placeholder="Nome do cliente" value={name} onChange={setName} />
        <KeyboardInput label="NIF (opcional)" placeholder="NIF" value={nif} onChange={setNif} numeric />
        <Button variant="primary" block loading={creating} onClick={create}>
          {creating ? 'A criar…' : 'Adicionar cliente'}
        </Button>
      </div>
    </Dialog>
  );
}
