import React, { useState } from 'react';
import { api, ApiError } from '../api/client';
import { IconReceipt } from '../components/Icons';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** Exportação do ficheiro SAF-T (AO) mensal — auditoria fiscal exigida pela AGT. */
export function Saft() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const years: number[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) years.push(y);

  const exportSaft = async () => {
    setError(null); setInfo(null); setBusy(true);
    try {
      const xml = await api.saft.export(year, month);
      if (!xml || !xml.includes('<AuditFile')) {
        throw new ApiError(0, 'O servidor não devolveu um SAF-T válido.');
      }
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SAFT-AO-${year}-${String(month).padStart(2, '0')}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setInfo(`SAF-T de ${MONTHS[month - 1]} de ${year} descarregado.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível exportar o SAF-T.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="content-head"><h2>Fiscal · SAF-T (AGT)</h2></div>

      {info ? <div className="banner success" style={{ marginBottom: 12 }}>{info}</div> : null}
      {error ? <div className="banner danger" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="card" style={{ maxWidth: 520 }}>
        <h3 style={{ marginTop: 0 }}>Exportar ficheiro SAF-T (AO)</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Gera o ficheiro de auditoria fiscal mensal (XML) exigido pela AGT, com todas as
          facturas e documentos emitidos no período.
        </p>
        <div className="grid-2">
          <div className="field">
            <label>Mês</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Ano</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <button className="btn lg block" style={{ marginTop: 8 }} onClick={exportSaft} disabled={busy}>
          <IconReceipt size={18} /> {busy ? 'A gerar…' : 'Exportar SAF-T'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          O ficheiro descarrega-se como <strong>SAFT-AO-{year}-{String(month).padStart(2, '0')}.xml</strong>.
          Entrega-o à AGT ou importa-o no portal fiscal.
        </p>
      </div>
    </>
  );
}
