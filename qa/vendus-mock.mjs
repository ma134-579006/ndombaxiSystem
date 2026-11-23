/**
 * SIMULADOR LOCAL da API Cegid Vendus — NÃO é o Vendus.
 *
 * Reproduz o contrato da especificação OpenAPI publicada pela Cegid
 * (https://www.vendus.co.ao/ws/v1.1/api.jsonapi, consultada a 21-11-2026):
 *   /ws/v1.1/account/, stores/, registers/, registers/{id}/, taxes/, taxes/exemptions/,
 *   documents/paymentmethods/, products/units/, clients/ (GET/POST), clients/{id}/ (PATCH),
 *   products/ (GET/POST), products/{id}/ (PATCH), documents/ (GET/POST), documents/{id}/,
 *   documents/{id}.pdf, taxauthority/saft/ — autenticação Bearer.
 * O que a especificação não diz (formato do corpo de erro, semântica de tx_id repetido)
 * é simulado de forma conservadora e está assinalado.
 *
 * Controlo (só testes): POST /__control {mode, times, apiKey, account, register…}; GET /__control.
 * Modos: ok | http500 | http429 | invalid-key | reject (422) | lost (cria e responde 500)
 *        | slow (cria e responde depois de `delayMs`) | subscription-off.
 */
import http from 'node:http';

export function startVendusMock({ port = 3997, apiKey }) {
  const st = {
    apiKey,
    mode: 'ok', times: 0, delayMs: 5000,
    account: { id: 77, company: 'Empresa QA, Lda', fiscal_id: '', country: 'AO', address: 'Rua 1', postal_code: '', city: 'Luanda', email: 'qa@qa.test' },
    registers: [{ id: 9, store_id: 1, title: 'Caixa API', type: 'api', status: 'on', mode: 'normal', subscription_active: 'yes', expires: '2027-12-31' }],
    taxes: [
      { id: 'NOR', rate: 14, country: 'AO', title: 'Taxa Normal' },
      { id: 'ISE', rate: 0, country: 'AO', title: 'Isento' },
      { id: 'NOR', rate: 23, country: 'PT', title: 'Taxa Normal (PT)' },
    ],
    exemptions: [{ id: 'M10', text: 'Isento nos termos da alínea …' }],
    clients: new Map(), products: new Map(), docs: new Map(), seq: 0, idSeq: 1000,
    log: [], urlKeyLeak: false,
  };
  // Cada modo só se gasta no pedido a que se destina (ex.: 'lost' só no POST /documents/).
  const TARGET = { 'subscription-off': (m, p) => m === 'GET' && /^registers\/\d+$/.test(p), lost: (m, p) => m === 'POST' && p === 'documents', slow: (m, p) => m === 'POST' && p === 'documents', reject: (m, p) => m === 'POST' && p === 'documents' };
  const consume = (method, path) => {
    if (st.mode === 'ok') return 'ok';
    const applies = TARGET[st.mode] ? TARGET[st.mode](method, path) : true;
    if (!applies) return 'ok';
    const m = st.mode;
    if (st.times > 0 && --st.times === 0) st.mode = 'ok';
    return m;
  };
  const PDF = (n) => Buffer.from(`%PDF-1.4\n% Documento ${n} (simulador Vendus)\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`, 'latin1');

  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'Rate-Limit-Remaining': '99', 'Rate-Limit-Reset': '20' }); res.end(Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body)); };
      const u = new URL(req.url ?? '/', 'http://x');
      if (u.pathname.startsWith('/__control')) {
        if (req.method === 'GET') return send(200, { log: st.log, docs: [...st.docs.values()].map((d) => ({ id: d.id, number: d.number, type: d.type, mode: d.mode, tx_id: d.tx_id, external_reference: d.external_reference, register_id: d.register_id, payments: d.payments ?? null })), clients: st.clients.size, products: st.products.size, urlKeyLeak: st.urlKeyLeak });
        const c = JSON.parse(raw || '{}');
        if (c.mode) { st.mode = c.mode; st.times = c.times ?? 1; }
        if (c.delayMs) st.delayMs = c.delayMs;
        if (c.apiKey) st.apiKey = c.apiKey;
        if (c.account) Object.assign(st.account, c.account);
        if (c.register) Object.assign(st.registers[0], c.register);
        if (c.addRegister && !st.registers.some((r) => r.id === c.addRegister.id)) st.registers.push(c.addRegister);
        return send(200, { ok: true });
      }
      if (u.searchParams.has('api_key')) st.urlKeyLeak = true;
      const m = /^\/ws\/v(1\.[012])\/(.+?)\/?$/.exec(u.pathname);
      const entry = { at: new Date().toISOString(), method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), status: 0 };
      st.log.push(entry);
      if (!m) { entry.status = 404; return send(404, { message: 'Not Found' }); }
      if (req.headers.authorization !== `Bearer ${st.apiKey}`) { entry.status = 401; return send(401, { errors: [{ code: 'A001', message: 'Unauthorized' }] }); }
      const path0 = (/^\/ws\/v1\.[012]\/(.+?)\/?$/.exec(u.pathname) ?? [])[1] ?? '';
      const mode = consume(req.method, path0);
      entry.mode = mode;
      if (mode === 'invalid-key') { entry.status = 401; return send(401, { errors: [{ code: 'A001', message: 'Unauthorized' }] }); }
      if (mode === 'http500') { entry.status = 500; return send(500, { errors: [{ message: 'Internal error' }] }); }
      if (mode === 'http429') { entry.status = 429; return send(429, { errors: [{ message: 'Too Many Requests' }] }); }
      const path = m[2];
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { entry.status = 400; return send(400, { errors: [{ message: 'Could not parse request' }] }); } }
      const q = Object.fromEntries(u.searchParams);

      if (path === 'account' && req.method === 'GET') { entry.status = 200; return send(200, st.account); }
      if (path === 'stores') return send(200, [{ id: 1, type: 'store', title: 'Loja', status: 'on', country: 'AO' }]);
      if (path === 'registers') return send(200, st.registers);
      if (/^registers\/\d+$/.test(path)) {
        const r = st.registers.find((x) => String(x.id) === path.split('/')[1]);
        return r ? send(200, { ...r, subscription_active: mode === 'subscription-off' ? 'no' : r.subscription_active }) : send(404, { message: 'No data' });
      }
      if (path === 'taxes') return send(200, st.taxes);
      if (path === 'taxes/exemptions') return send(200, st.exemptions);
      if (path === 'documents/paymentmethods') return send(200, [{ id: 3, title: 'Numerário', type: 'NU' }, { id: 4, title: 'Multicaixa', type: 'MB' }]);
      if (path === 'products/units') return send(200, [{ id: 1, title: 'Unidade' }]);
      if (path === 'clients') {
        if (req.method === 'GET') return send(200, [...st.clients.values()].filter((c) => (!q.fiscal_id || c.fiscal_id === q.fiscal_id) && (!q.external_reference || c.external_reference === q.external_reference)));
        const id = ++st.idSeq; st.clients.set(id, { id, ...body }); return send(201, { id, ...body });
      }
      if (/^clients\/\d+$/.test(path) && req.method === 'PATCH') { const id = Number(path.split('/')[1]); const c = st.clients.get(id); if (!c) return send(404, { message: 'No data' }); Object.assign(c, body); return send(200, c); }
      if (path === 'products') {
        if (req.method === 'GET') return send(200, [...st.products.values()].filter((p) => !q.reference || p.reference === q.reference));
        if (!body.title || !body.unit_id) return send(422, { errors: [{ message: 'title e unit_id obrigatórios' }] });
        const id = ++st.idSeq; st.products.set(id, { id, ...body }); return send(201, { id, ...body });
      }
      if (/^products\/\d+$/.test(path) && req.method === 'PATCH') { const id = Number(path.split('/')[1]); const p = st.products.get(id); if (!p) return send(404, { message: 'No data' }); Object.assign(p, body); return send(200, p); }
      if (path === 'documents' && req.method === 'GET') {
        const list = [...st.docs.values()].filter((d) => (!q.external_reference || d.external_reference === q.external_reference) && (!q.mode || d.mode === q.mode));
        return send(200, list.map(summary));
      }
      if (path === 'documents' && req.method === 'POST') {
        if (mode === 'reject') { entry.status = 422; return send(422, { errors: [{ code: 'D010', message: 'Dados do documento inválidos (simulado)' }] }); }
        const regType = st.registers.find((r) => String(r.id) === String(body.register_id))?.type;
        if (regType !== 'api') { entry.status = 422; return send(422, { errors: [{ code: 'A001', message: "Register's type must be [API] and it is not. Please edit this register using your backoffice." }] }); }
        if (!Array.isArray(body.items) || !body.items.length) return send(422, { errors: [{ message: 'items obrigatório' }] });
        for (const it of body.items) {
          if (!Number.isInteger(it.qty)) return send(422, { errors: [{ message: 'qty' }] });
          if (body.type === 'NC' && !it.reference_document?.document_number) return send(422, { errors: [{ message: 'reference_document obrigatório na NC' }] });
          if (it.tax_id && !st.taxes.some((t) => t.id === it.tax_id && t.country === 'AO')) return send(422, { errors: [{ message: `tax_id ${it.tax_id}` }] });
        }
        if (body.type === 'FR' && !(Array.isArray(body.payments) && body.payments.length)) return send(422, { errors: [{ code: 'A001', message: { type: 'FR_HAVE_TO_PAY', message: 'Para este tipo de documento, o pagamento deve ser realizado no ato.' } }] });
                if (body.type === 'NC' && !body.notes) return send(422, { errors: [{ message: 'notes obrigatório na NC' }] });
        // tx_id repetido: a especificação só diz "Transaction unique identifier". O simulador
        // devolve o documento já criado (comportamento conservador; ver docs/fiscal-engine).
        const prev = body.tx_id ? [...st.docs.values()].find((d) => d.tx_id === body.tx_id) : null;
        if (prev) { entry.status = 201; entry.dupTx = true; return send(201, summary(prev)); }
        const doc = createDoc(body);
        if (mode === 'lost') { entry.status = 500; return send(500, { errors: [{ message: 'Internal error' }] }); }
        if (mode === 'slow') { await new Promise((r) => setTimeout(r, st.delayMs)); }
        entry.status = 201;
        return send(201, summary(doc));
      }
      const pdf = /^documents\/(\d+)\.pdf$/.exec(path);
      if (pdf) { const d = st.docs.get(Number(pdf[1])); return d ? send(200, PDF(d.number), 'application/pdf') : send(404, { message: 'No data' }); }
      const one = /^documents\/(\d+)$/.exec(path);
      if (one && req.method === 'GET') {
        const d = st.docs.get(Number(one[1]));
        if (!d) return send(404, { message: 'No data' });
        // Talão imprimível (output=html|escpos), com a versão (ORIGINAL/DUPLICATE) e a caixa.
        if (q.output === 'html') return send(200, { ...d, output: 'html', output_data: `<!doctype html><html><head><title>${d.number}</title></head><body><p>${d.number}</p><p>${q.output_version ?? ''}</p><p>caixa ${q.register_id ?? ''}</p><p>hash ${d.hash}</p></body></html>` });
        if (q.output === 'escpos') return send(200, { ...d, output: 'escpos', output_data: Buffer.from(`\x1b@${d.number}\n${q.output_version ?? ''}\n\x1dVB\x00`, 'binary').toString('base64') });
        return send(200, d);
      }
      if (path === 'taxauthority/saft') {
        const xml = `<?xml version="1.0" encoding="UTF-8"?><AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:AO_1.01_01"><Header><TaxRegistrationNumber>${st.account.fiscal_id}</TaxRegistrationNumber><StartDate>${q.year}-${String(q.month).padStart(2, '0')}-01</StartDate><ProductID>Vendus/Cegid</ProductID><SoftwareValidationNumber>142/AGT/2019</SoftwareValidationNumber></Header></AuditFile>`;
        return send(200, { year: Number(q.year), month: Number(q.month), xml: Buffer.from(xml).toString('base64') });
      }
      entry.status = 404;
      return send(404, { message: 'Not Found' });
    });
  });

  function createDoc(body) {
    const id = ++st.idSeq;
    const type = body.type ?? 'FT';
    const n = ++st.seq;
    const items = body.items.map((it, i) => {
      const src = it.reference_document ? [...st.docs.values()].find((d) => d.number === it.reference_document.document_number) : null;
      const srcItem = src?.items?.[it.reference_document.document_row - 1];
      const gross = srcItem ? Number(srcItem.amounts[0].gross_unit) : Number(it.gross_price ?? 0) * (1 - Number(it.discount_percentage ?? 0) / 100);
      return { id: it.id ?? srcItem?.id ?? 5000 + i, qty: it.qty, title: it.title ?? srcItem?.title ?? '', reference: it.reference ?? srcItem?.reference ?? '', amounts: [{ gross_unit: gross.toFixed(2), gross_total: (gross * it.qty).toFixed(2) }], tax: { id: it.tax_id ?? 'NOR', country: 'AO' } };
    });
    const gross = items.reduce((s, x) => s + Number(x.amounts[0].gross_total), 0);
    const number = `${type} AO${new Date().getFullYear()}S1/${n}`;
    const doc = {
      id, type, subtype: '', number, date: new Date().toISOString().slice(0, 10), system_time: new Date().toISOString(),
      amount_gross: gross.toFixed(2), amount_net: (gross / 1.14).toFixed(2), external_reference: body.external_reference ?? '',
      register_id: body.register_id, mode: body.mode ?? 'normal', tx_id: body.tx_id ?? null, items, payments: body.payments ?? null,
      client: body.client ?? null, hash: 'AbCd', atcud: '', qrcode: '<svg/>', qrcode_data: `A:${st.account.fiscal_id}*B:${body.client?.fiscal_id ?? ''}*N:${number}`,
      agt: { document_number: number, qrcode_image: 'data:image/png;base64,' },
      status: { id: 'N' },
    };
    st.docs.set(id, doc);
    return doc;
  }
  const summary = (d) => ({ id: d.id, type: d.type, number: d.number, date: d.date, system_time: d.system_time, amount_gross: d.amount_gross, amount_net: d.amount_net, hash: d.hash, external_reference: d.external_reference });

  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, st, url: `http://127.0.0.1:${port}/ws` })));
}
