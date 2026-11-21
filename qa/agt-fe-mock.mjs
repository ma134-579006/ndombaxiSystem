/**
 * SIMULADOR LOCAL da API de Facturação Electrónica da AGT — NÃO é a AGT.
 *
 * Reproduz o contrato publicado no Portal do Parceiro (documentação técnica v2,
 * https://portaldoparceiro.minfin.gov.ao/doc-agt/doc-agt/2/index.html, consultada
 * em 21-11-2026): POST /<serviço>, HTTP Basic, JWS RS256 compacto, códigos de erro
 * E01…E99 e o modelo assíncrono registarFactura → requestID → obterEstado.
 * Só devolve respostas documentadas. Verifica DE VERDADE:
 *   • Basic Auth (401 se errado);
 *   • jwsSoftwareSignature com a chave pública do software registada (E08) e o
 *     softwareValidationNumber registado (E07);
 *   • jwsSignature / jwsDocumentSignature com a chave do contribuinte (E40), e que
 *     o payload assinado é igual aos campos enviados (E39);
 *   • estrutura (schemaVersion, submissionUUID, numberOfEntries ≤ 30, documentNo),
 *     totais (soma das linhas) e duplicados (E09, com successRequestID).
 *
 * Controlo (só para os testes): POST /__control {mode, times, keys…}; GET /__control/log.
 * Modos: ok | http500 | http429 | malformed | timeout | lost (regista e responde 500)
 *        | processing (obterEstado devolve 8 uma vez) | reject-series | invalid-next.
 */
import http from 'node:http';
import { createVerify, randomUUID } from 'node:crypto';

export function startAgtMock({ port = 3996, user = 'qa-produtor', pass } = {}) {
  const st = {
    user, pass, softwarePub: null, validationNumber: null, taxpayers: new Map(),
    mode: 'ok', times: 0, docs: new Map(), requests: new Map(), series: new Map(), log: [], seq: 0,
  };
  const b64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
  const verifyJws = (jws, pem) => {
    try {
      const [h, p, s] = String(jws ?? '').split('.');
      if (!h || !p || !s || !pem) return null;
      const header = JSON.parse(b64(h));
      if (header.alg !== 'RS256') return null;
      const v = createVerify('RSA-SHA256'); v.update(`${h}.${p}`); v.end();
      return v.verify(pem, Buffer.from(s, 'base64url')) ? JSON.parse(b64(p)) : null;
    } catch { return null; }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const consume = () => { if (st.times > 0 && --st.times === 0) { const m = st.mode; st.mode = 'ok'; return m; } return st.mode; };
  const err = (code, d) => ({ idError: code, descriptionError: d });

  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
      const url = req.url ?? '/';
      if (url.startsWith('/__control')) {
        if (req.method === 'GET') return send(200, { log: st.log, docs: [...st.docs.keys()], series: [...st.series.values()] });
        const c = JSON.parse(raw || '{}');
        if (c.mode) { st.mode = c.mode; st.times = c.times ?? 1; }
        if (c.softwarePub) st.softwarePub = c.softwarePub;
        if (c.validationNumber) st.validationNumber = c.validationNumber;
        if (c.taxpayer) st.taxpayers.set(c.taxpayer.nif, c.taxpayer.pub);
        if (c.pass) st.pass = c.pass;
        return send(200, { ok: true });
      }
      const service = url.split('/').filter(Boolean).pop();
      const entry = { at: new Date().toISOString(), service, status: 0 };
      st.log.push(entry);
      const auth = String(req.headers.authorization ?? '');
      if (auth !== `Basic ${Buffer.from(`${st.user}:${st.pass}`).toString('base64')}`) { entry.status = 401; return send(401, { errorEntry: err('E01', 'Credenciais inválidas') }); }
      const mode = consume();
      entry.mode = mode;
      if (mode === 'http500') { entry.status = 500; return send(500, { errorEntry: err('E99', 'Erro interno') }); }
      if (mode === 'http429') { entry.status = 429; return send(429, { errorEntry: err('E98', 'erro na chamada, demasiadas solicitações repetidas') }); }
      if (mode === 'malformed') { entry.status = 200; return send(200, '<html>gateway</html>'); }
      if (mode === 'timeout') { await new Promise((r) => setTimeout(r, 35_000)); entry.status = 504; return send(504, {}); }
      let body;
      try { body = JSON.parse(raw); } catch { entry.status = 400; return send(400, { errorList: [err('E96', 'Erro de estrutura')] }); }
      const nif = body.taxRegistrationNumber;
      const taxpayerPub = st.taxpayers.get(nif);
      const errors = [];
      if (body.schemaVersion !== '2.0') errors.push(err('E96', 'schemaVersion'));
      const sw = body.softwareInfo ?? {};
      const swPayload = verifyJws(sw.jwsSoftwareSignature, st.softwarePub);
      const detail = sw.softwareInfoDetail ?? {};
      if (!swPayload) errors.push(err('E08', 'jwsSoftwareSignature inválida'));
      else if (!same(swPayload, { productId: detail.productId, productVersion: detail.productVersion, softwareValidationNumber: detail.softwareValidationNumber })) errors.push(err('E39', 'Dados do software diferentes da certificação'));
      if (detail.softwareValidationNumber !== st.validationNumber) errors.push(err('E07', 'Software não certificado'));
      if (!taxpayerPub) errors.push(err('E28', 'Contribuinte não aderiu à facturação electrónica'));

      if (service === 'registarFactura') {
        if (!/^[0-9a-f-]{36}$/i.test(body.submissionUUID ?? '')) errors.push(err('E96', 'submissionUUID'));
        const docs = Array.isArray(body.documents) ? body.documents : [];
        if (docs.length === 0 || docs.length > 30 || body.numberOfEntries !== docs.length) errors.push(err('E96', 'numberOfEntries/documents'));
        if (errors.length) { entry.status = 400; return send(400, { errorList: errors }); }
        if (mode === 'lost') entry.lost = true;
        const requestID = String(Date.now()).slice(-9) + String(++st.seq).padStart(6, '0');
        const statusList = [];
        let invalidOnce = mode === 'invalid-next';
        for (const d of docs) {
          const de = [];
          const signed = verifyJws(d.jwsDocumentSignature, taxpayerPub);
          if (!signed) de.push({ errorCode: 'E40', errorDescription: 'jwsDocumentSignature inválida' });
          else if (!same(signed, { documentNo: d.documentNo, taxRegistrationNumber: nif, documentType: d.documentType, documentDate: d.documentDate, customerTaxID: d.customerTaxID, customerCountry: d.customerCountry, companyName: d.companyName, documentTotals: d.documentTotals })) de.push({ errorCode: 'E39', errorDescription: 'Payload assinado diferente do documento' });
          if (!/^[^ ]+ [^/ ]+\/[0-9]+$/.test(d.documentNo ?? '')) de.push({ errorCode: 'E02', errorDescription: 'documentNo' });
          const net = (d.lines ?? []).reduce((s, l) => s + Number(l.creditAmount ?? l.debitAmount ?? 0), 0);
          if (Math.abs(net - Number(d.documentTotals?.netTotal)) > 0.011) de.push({ errorCode: 'E23', errorDescription: 'netTotal ≠ soma das linhas' });
          const tax = (d.lines ?? []).reduce((s, l) => s + (l.taxes ?? []).reduce((t, x) => t + Number(x.taxContribution ?? 0), 0), 0);
          if (Math.abs(tax - Number(d.documentTotals?.taxPayable)) > 0.011) de.push({ errorCode: 'E22', errorDescription: 'taxPayable ≠ soma das contribuições' });
          if (invalidOnce) { de.push({ errorCode: 'E20', errorDescription: 'Regra fiscal violada (simulada)' }); invalidOnce = false; }
          const prev = st.docs.get(d.documentNo);
          if (prev && !de.length) { statusList.push({ documentNo: d.documentNo, documentStatus: 'I', errorList: [{ errorCode: 'E09', errorDescription: 'Documento já existe' }], successRequestID: prev.requestID }); continue; }
          if (!de.length) st.docs.set(d.documentNo, { requestID, status: 'V', doc: d });
          statusList.push({ documentNo: d.documentNo, documentStatus: de.length ? 'I' : 'V', ...(de.length ? { errorList: de } : {}) });
        }
        const v = statusList.filter((x) => x.documentStatus === 'V').length;
        st.requests.set(requestID, { nif, statusList, resultCode: v === statusList.length ? 0 : v === 0 ? 2 : 1, polled: 0 });
        if (mode === 'lost') { entry.status = 500; return send(500, { errorEntry: err('E99', 'Erro interno (resposta perdida)') }); }
        entry.status = 200; entry.requestID = requestID;
        return send(200, { requestID, errorList: [] });
      }

      const reqSig = verifyJws(body.jwsSignature, taxpayerPub);
      if (!reqSig || reqSig.taxRegistrationNumber !== nif) errors.push(err('E40', 'jwsSignature inválida'));

      if (service === 'obterEstado') {
        if (errors.length) { entry.status = 400; return send(400, { errorList: errors }); }
        const r = st.requests.get(body.requestID);
        if (!r || r.nif !== nif) { entry.status = 422; return send(422, { errorEntry: err('E94', 'erro na chamada, nif diferente') }); }
        if (mode === 'processing') { entry.status = 200; return send(200, { requestID: body.requestID, resultCode: '8', taxRegistrationNumber: nif, documentStatusList: [], requestErrorList: [] }); }
        entry.status = 200;
        return send(200, { requestID: body.requestID, resultCode: String(r.resultCode), taxRegistrationNumber: nif, documentStatusList: r.statusList, requestErrorList: [] });
      }
      if (service === 'consultarFactura') {
        if (errors.length) { entry.status = 400; return send(400, { errorList: errors }); }
        const no = body.documentNo ?? body.invoiceNo;
        const d = st.docs.get(no);
        if (!d) { entry.status = 400; return send(400, { errorEntry: err('E93', `Documento desconhecido (${no})`) }); }
        entry.status = 200;
        return send(200, { statusResult: { documentNo: no, validationStatus: d.status } });
      }
      if (service === 'solicitarSerie') {
        if (!reqSig || !same(reqSig, { taxRegistrationNumber: nif, seriesYear: body.seriesYear, documentType: body.documentType, establishmentNumber: body.establishmentNumber, seriesContingencyIndicator: body.seriesContingencyIndicator })) errors.push(err('E39', 'Payload da série diferente do assinado'));
        if (mode === 'reject-series') errors.push(err('E31', 'Estabelecimento não registado (simulado)'));
        if (errors.length) { entry.status = 400; return send(400, { errorList: errors }); }
        const code = `${body.documentType}${String(nif).slice(-2)}${String(body.seriesYear).slice(-2)}S${st.series.size + 1}${body.seriesContingencyIndicator ?? 'N'}`;
        st.series.set(code, { code, ...body });
        entry.status = 200;
        return send(200, { resultCode: 0, errorList: [], seriesFEResult: { seriesCode: code, authorizedQuantity: '999999999999', firstDocumentNo: '1', lastDocumentNo: '999999999999' } });
      }
      if (service === 'listarSeries') {
        if (errors.length) { entry.status = 400; return send(400, { errorList: errors }); }
        const list = [...st.series.values()];
        entry.status = 200;
        return send(200, { seriesResultCount: list.length, seriesInfo: list.map((s) => ({ seriesCode: s.code, seriesYear: s.seriesYear, documentType: s.documentType, seriesStatus: 'U', seriesContingencyIndicator: s.seriesContingencyIndicator })) });
      }
      entry.status = 404;
      return send(404, { errorEntry: err('E96', `Serviço desconhecido: ${service}`) });
    });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, st, url: `http://127.0.0.1:${port}`, uuid: randomUUID })));
}
