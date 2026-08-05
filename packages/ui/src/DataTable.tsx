import React from 'react';
import { EmptyState, Skeleton } from './Feedback';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Conteúdo da célula. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Coluna numérica: alinha à direita e usa dígitos tabulares. */
  numeric?: boolean;
  /** Largura fixa (ex.: '120px', '1fr' não se aplica a tabelas). */
  width?: string;
  /** Ordenável por esta chave. */
  sortable?: boolean;
  /** Esconde a coluna no telemóvel — a informação secundária primeiro. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  /** Nº de linhas-esqueleto durante o carregamento. */
  skeletonRows?: number;
  empty?: React.ReactNode;
  compact?: boolean;
  onRowClick?: (row: T, index: number) => void;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (key: string) => void;
  /** Descrição da tabela para leitores de ecrã. */
  caption?: string;
}

/**
 * Tabela de dados do sistema.
 *
 * Resolve de uma vez três coisas que cada secção reimplementava mal:
 * o estado de carregamento (esqueleto no lugar certo, sem salto de
 * layout), o estado vazio (com saída, não uma tabela em branco) e o
 * scroll horizontal contido — a tabela rola dentro de si, a página não.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  skeletonRows = 5,
  empty,
  compact,
  onRowClick,
  sort,
  onSortChange,
  caption,
}: DataTableProps<T>) {
  if (!loading && rows.length === 0) {
    return <>{empty ?? <EmptyState title="Sem registos" text="Ainda não há nada para mostrar aqui." />}</>;
  }

  return (
    <div className="nx-table-wrap">
      <table className={['nx-table', compact && 'nx-table--compact'].filter(Boolean).join(' ')}>
        {caption && <caption className="nx-sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = c.sortable ? (active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={[c.numeric && 'nx-num', c.hideOnMobile && 'nx-hide-mobile'].filter(Boolean).join(' ')}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={ariaSort}
                  onClick={c.sortable && onSortChange ? () => onSortChange(c.key) : undefined}
                >
                  {c.header}
                  {c.sortable && (
                    <span aria-hidden="true" style={{ opacity: active ? 1 : 0.3, marginLeft: 4 }}>
                      {active && sort!.dir === 'desc' ? '↓' : '↑'}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.hideOnMobile ? 'nx-hide-mobile' : undefined}>
                      <Skeleton height={14} />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={[c.numeric && 'nx-num', c.hideOnMobile && 'nx-hide-mobile'].filter(Boolean).join(' ')}
                    >
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
