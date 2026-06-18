import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { IvaCode } from '@nexus/agt-xml';
import { PosRepository } from '../pos/pos.repository';
import { AiConfigService } from './ai-config.service';

/**
 * FERRAMENTAS do agente IA do gestor — operam sobre os dados REAIS da empresa
 * (schema do tenant) com regras de segurança duras:
 *   • LEITURA livre (vendas, lucros, stock, funcionários, anomalias…);
 *   • ESCRITA só por ferramentas whitelisted (preço, cliente, despesa,
 *     stock mínimo) — NUNCA elimina nada — e TUDO fica na auditoria imutável;
 *   • SAÍDAS: planilhas XLSX, PDFs, imagens (Gemini), guias visuais e
 *     mensagens WhatsApp (Meta Cloud API ou links wa.me).
 */

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolFile { kind: 'xlsx' | 'pdf' | 'png'; name: string; base64: string; mime: string }
export interface ToolOutcome {
  /** resumo textual para o modelo continuar a raciocinar */
  result: string;
  /** anexos para o frontend (ficheiros, imagens, guia, link whatsapp) */
  file?: ToolFile;
  imageBase64?: string;
  guideUrl?: string;
  waLink?: string;
}

const GUIDES: Record<string, string> = {
  criar_conta: '/guides/criar-conta.png', login_caixa: '/guides/login-caixa.png',
  vender_caixa: '/guides/vender-caixa.png', criar_produto: '/guides/criar-produto.png',
  entrada_stock: '/guides/entrada-stock.png', folha_salarial: '/guides/folha-salarial.png',
  relatorios: '/guides/relatorios.png', loja_online: '/guides/loja-online.png',
};

const fmtKz = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} Kz`;

@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    private readonly aiCfg: AiConfigService,
    private readonly pos: PosRepository,
  ) {}

  /** Definições (function-calling, formato OpenAI/Gemini). */
  defs(): ToolDef[] {
    const num = (d: string) => ({ type: 'number', description: d });
    const str = (d: string) => ({ type: 'string', description: d });
    return [
      { name: 'resumo_vendas', description: 'Resumo REAL de vendas do período: total, nº de documentos, ticket médio, IVA, por dia.', parameters: { type: 'object', properties: { dias: num('Nº de dias para trás (1-365). Default 7.') } } },
      { name: 'top_produtos', description: 'Produtos mais vendidos no período (quantidade e valor).', parameters: { type: 'object', properties: { dias: num('Período em dias. Default 30.'), limite: num('Quantos produtos. Default 10.') } } },
      { name: 'desempenho_funcionarios', description: 'Desempenho REAL por operador: vendas, total, ticket médio, cancelamentos. Usa para encontrar os melhores e os fracos.', parameters: { type: 'object', properties: { dias: num('Período em dias. Default 30.') } } },
      { name: 'detetar_anomalias', description: 'Auditoria anti-fraude: cancelamentos suspeitos por operador, vendas fora de horas (22h-06h), diferenças de fecho de caixa, stock negativo, ajustes de stock sem venda. Usa quando o gestor suspeitar de roubo, quebras ou erros de cálculo.', parameters: { type: 'object', properties: { dias: num('Período em dias. Default 30.') } } },
      { name: 'stock_critico', description: 'Stock baixo/negativo e lotes a expirar.', parameters: { type: 'object', properties: {} } },
      { name: 'lucro_resumo', description: 'Lucro bruto/líquido REAL do período (vendas - custos - gastos).', parameters: { type: 'object', properties: { dias: num('Período em dias. Default 30.') } } },
      { name: 'gastos_resumo', description: 'Gastos/despesas do período por categoria.', parameters: { type: 'object', properties: { dias: num('Período em dias. Default 30.') } } },
      { name: 'listar_funcionarios', description: 'Lista funcionários (nome, função, telefone, salário).', parameters: { type: 'object', properties: {} } },
      { name: 'listar_clientes', description: 'Lista clientes registados (nome, telefone, email).', parameters: { type: 'object', properties: { limite: num('Default 30.') } } },
      { name: 'mapa_iva', description: 'Mapa de IVA do mês (base e imposto por taxa) — alinhado à AGT.', parameters: { type: 'object', properties: { ano: num('Ano (ex.: 2026)'), mes: num('Mês 1-12') } } },
      // ── escrita RESTRITA (nunca elimina; tudo auditado) ──
      { name: 'atualizar_preco_produto', description: 'ALTERA o preço de venda de um produto (não elimina nada; fica auditado). Confirma sempre com o gestor antes de usar.', parameters: { type: 'object', properties: { produto: str('Nome ou código do produto'), novo_preco: num('Novo preço de venda em Kz (sem IVA)') }, required: ['produto', 'novo_preco'] } },
      { name: 'criar_cliente', description: 'Cria um cliente novo (auditado).', parameters: { type: 'object', properties: { nome: str('Nome'), telefone: str('Telefone (opcional)'), email: str('Email (opcional)') }, required: ['nome'] } },
      { name: 'criar_produto', description: 'CRIA um produto novo no catálogo (gravado na base de dados, com stock inicial em todas as lojas, auditado; NUNCA elimina). Usa quando o gestor pedir para cadastrar/criar/adicionar um produto.', parameters: { type: 'object', properties: { nome: str('Nome do produto'), preco: num('Preço de venda em Kz (sem IVA)'), custo: num('Preço de custo em Kz (opcional)'), stock_inicial: num('Quantidade de stock inicial (opcional, default 0)'), codigo: str('Código/código de barras (opcional — gerado se faltar)'), iva: str("Código de IVA: NOR (14%), INT, RED, ISE (isento), OUT (não sujeito). Default = o padrão da empresa.") }, required: ['nome', 'preco'] } },
      { name: 'criar_despesa', description: 'Regista uma despesa/gasto (auditado).', parameters: { type: 'object', properties: { descricao: str('Descrição'), valor: num('Valor em Kz'), categoria: str('Categoria (opcional, ex.: RENDA, AGUA_LUZ, OUTROS)') }, required: ['descricao', 'valor'] } },
      { name: 'ajustar_stock_minimo', description: 'Define o stock mínimo de alerta de um produto (auditado).', parameters: { type: 'object', properties: { produto: str('Nome ou código'), minimo: num('Stock mínimo') }, required: ['produto', 'minimo'] } },
      // ── saídas ──
      { name: 'criar_planilha', description: 'Cria uma planilha Excel (.xlsx) para o gestor descarregar. Usa dados REAIS obtidos antes com outras ferramentas.', parameters: { type: 'object', properties: { titulo: str('Nome do ficheiro'), colunas: { type: 'array', items: { type: 'string' }, description: 'Cabeçalhos' }, linhas: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Linhas (arrays de células)' } }, required: ['titulo', 'colunas', 'linhas'] } },
      { name: 'criar_pdf', description: 'Cria um PDF profissional (relatório/carta) para descarregar.', parameters: { type: 'object', properties: { titulo: str('Título'), paragrafos: { type: 'array', items: { type: 'string' }, description: 'Parágrafos do documento' }, tabela_colunas: { type: 'array', items: { type: 'string' }, description: 'Cabeçalhos da tabela (opcional)' }, tabela_linhas: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Linhas da tabela (opcional)' } }, required: ['titulo', 'paragrafos'] } },
      { name: 'criar_imagem', description: 'Gera uma imagem com IA (ex.: cartaz de promoção, logótipo de campanha).', parameters: { type: 'object', properties: { descricao: str('Descrição detalhada da imagem') }, required: ['descricao'] } },
      { name: 'mostrar_guia', description: 'Mostra um screenshot REAL do sistema com marcações que ensina um fluxo.', parameters: { type: 'object', properties: { nome: { type: 'string', enum: Object.keys(GUIDES), description: 'Qual guia' } }, required: ['nome'] } },
      { name: 'enviar_whatsapp', description: 'Envia (ou prepara) uma mensagem WhatsApp para um funcionário, cliente ou número. Com a integração Meta configurada envia DIRETO; senão devolve um link wa.me pronto.', parameters: { type: 'object', properties: { para: str('Nome do funcionário/cliente OU número com indicativo (ex.: 2449xxxxxxx)'), mensagem: str('Texto da mensagem') }, required: ['para', 'mensagem'] } },
    ];
  }

  /** Executa uma ferramenta no schema do tenant. NUNCA elimina nada. */
  async execute(schema: string, actor: { id: string; email: string; storeId?: string | null }, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const days = Math.min(365, Math.max(1, Number(args?.dias ?? 0) || 0));
    try {
      switch (name) {
        case 'resumo_vendas': return await this.resumoVendas(schema, days || 7);
        case 'top_produtos': return await this.topProdutos(schema, days || 30, Number(args?.limite) || 10);
        case 'desempenho_funcionarios': return await this.desempenho(schema, days || 30);
        case 'detetar_anomalias': return await this.anomalias(schema, days || 30);
        case 'stock_critico': return await this.stockCritico(schema);
        case 'lucro_resumo': return await this.lucro(schema, days || 30);
        case 'gastos_resumo': return await this.gastos(schema, days || 30);
        case 'listar_funcionarios': return await this.funcionarios(schema);
        case 'listar_clientes': return await this.clientes(schema, Number(args?.limite) || 30);
        case 'mapa_iva': return await this.mapaIva(schema, Number(args?.ano), Number(args?.mes));
        case 'atualizar_preco_produto': return await this.atualizarPreco(schema, actor, String(args?.produto ?? ''), Number(args?.novo_preco));
        case 'criar_cliente': return await this.criarCliente(schema, actor, args);
        case 'criar_produto': return await this.criarProduto(schema, actor, args);
        case 'criar_despesa': return await this.criarDespesa(schema, actor, args);
        case 'ajustar_stock_minimo': return await this.ajustarMinimo(schema, actor, String(args?.produto ?? ''), Number(args?.minimo));
        case 'criar_planilha': return this.planilha(args);
        case 'criar_pdf': return await this.pdf(args);
        case 'criar_imagem': return await this.imagem(String(args?.descricao ?? ''));
        case 'mostrar_guia': {
          const g = GUIDES[String(args?.nome ?? '')];
          return g ? { result: `Guia visual anexado (${args?.nome}).`, guideUrl: g } : { result: 'Guia desconhecido.' };
        }
        case 'enviar_whatsapp': return await this.whatsapp(schema, actor, String(args?.para ?? ''), String(args?.mensagem ?? ''));
        default: return { result: `Ferramenta desconhecida: ${name}` };
      }
    } catch (e) {
      this.logger.warn(`tool ${name} falhou: ${(e as Error).message}`);
      return { result: `A ferramenta ${name} falhou: ${(e as Error).message?.slice(0, 200)}` };
    }
  }

  // ── leitura ─────────────────────────────────────────────────
  private q<T>(schema: string, sql: Prisma.Sql): Promise<T[]> {
    return this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<T[]>(sql));
  }

  private async resumoVendas(schema: string, dias: number): Promise<ToolOutcome> {
    const tot = await this.q<{ n: number; total: number; iva: number }>(schema, Prisma.sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(gross_total),0)::float AS total, COALESCE(SUM(iva_total),0)::float AS iva
      FROM invoices WHERE status = 'N' AND doc_type IN ('FT','FS','FR') AND system_entry_date > now() - (${dias} || ' days')::interval`);
    const porDia = await this.q<{ dia: string; total: number; n: number }>(schema, Prisma.sql`
      SELECT to_char(system_entry_date::date,'YYYY-MM-DD') AS dia, COALESCE(SUM(gross_total),0)::float AS total, COUNT(*)::int AS n
      FROM invoices WHERE status = 'N' AND doc_type IN ('FT','FS','FR') AND system_entry_date > now() - (${dias} || ' days')::interval
      GROUP BY 1 ORDER BY 1`);
    const t = tot[0];
    const ticket = t.n ? t.total / t.n : 0;
    return { result: `Vendas (${dias} dias): ${fmtKz(t.total)} em ${t.n} documentos (ticket médio ${fmtKz(ticket)}; IVA ${fmtKz(t.iva)}). Por dia: ${porDia.map((d) => `${d.dia}=${fmtKz(d.total)}(${d.n})`).join(', ') || 'sem vendas'}` };
  }

  private async topProdutos(schema: string, dias: number, limite: number): Promise<ToolOutcome> {
    const rows = await this.q<{ description: string; qty: number; total: number }>(schema, Prisma.sql`
      SELECT ii.description, SUM(ii.quantity)::float AS qty, SUM(ii.gross_amount)::float AS total
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status='N' AND i.doc_type IN ('FT','FS','FR') AND i.system_entry_date > now() - (${dias} || ' days')::interval
      GROUP BY ii.description ORDER BY total DESC LIMIT ${Math.min(50, limite)}`);
    return { result: rows.length ? `Top produtos (${dias}d): ` + rows.map((r, i) => `${i + 1}. ${r.description}: ${r.qty} un, ${fmtKz(r.total)}`).join(' · ') : 'Sem vendas no período.' };
  }

  private async desempenho(schema: string, dias: number): Promise<ToolOutcome> {
    const rows = await this.q<{ cashier_name: string; n: number; total: number; canc: number }>(schema, Prisma.sql`
      SELECT COALESCE(u.name,'(sem nome)') AS cashier_name, COUNT(*) FILTER (WHERE i.status='N')::int AS n,
             COALESCE(SUM(i.gross_total) FILTER (WHERE i.status='N'),0)::float AS total,
             COUNT(*) FILTER (WHERE i.status='A')::int AS canc
      FROM invoices i LEFT JOIN users u ON u.id = i.cashier_id
      WHERE i.doc_type IN ('FT','FS','FR') AND i.system_entry_date > now() - (${dias} || ' days')::interval
      GROUP BY u.name ORDER BY total DESC`);
    return { result: rows.length ? `Desempenho por operador (${dias}d): ` + rows.map((r) => `${r.cashier_name}: ${fmtKz(r.total)} em ${r.n} vendas${r.canc ? `, ${r.canc} canceladas` : ''}`).join(' · ') : 'Sem atividade no período.' };
  }

  private async anomalias(schema: string, dias: number): Promise<ToolOutcome> {
    const findings: string[] = [];
    // 1. cancelamentos por operador (rácio alto = indício)
    const canc = await this.q<{ cashier_name: string; canc: number; tot: number }>(schema, Prisma.sql`
      SELECT COALESCE(u.name,'?') AS cashier_name, COUNT(*) FILTER (WHERE i.status='A')::int AS canc, COUNT(*)::int AS tot
      FROM invoices i LEFT JOIN users u ON u.id = i.cashier_id
      WHERE i.system_entry_date > now() - (${dias} || ' days')::interval
      GROUP BY u.name HAVING COUNT(*) FILTER (WHERE i.status='A') > 0`);
    for (const c of canc) {
      const pct = Math.round((c.canc / Math.max(1, c.tot)) * 100);
      if (pct >= 15 || c.canc >= 5) findings.push(`⚠️ ${c.cashier_name}: ${c.canc} cancelamentos em ${c.tot} docs (${pct}%) — rever os motivos um a um`);
    }
    // 2. vendas fora de horas (22h-06h)
    const noturnas = await this.q<{ n: number; total: number }>(schema, Prisma.sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(gross_total),0)::float AS total FROM invoices
      WHERE status='N' AND system_entry_date > now() - (${dias} || ' days')::interval
        AND (EXTRACT(hour FROM system_entry_date) >= 22 OR EXTRACT(hour FROM system_entry_date) < 6)`);
    if (noturnas[0]?.n > 0) findings.push(`🌙 ${noturnas[0].n} vendas fora de horas (22h-06h) no valor de ${fmtKz(noturnas[0].total)} — confirma se a loja opera nesse horário`);
    // 3. diferenças de fecho de caixa
    const fechos = await this.q<{ opened_by_name: string; diff: number; closed_at: Date }>(schema, Prisma.sql`
      SELECT COALESCE(opened_by_name,'?') AS opened_by_name, (counted_cash - expected_cash)::float AS diff, closed_at
      FROM cash_sessions WHERE closed_at IS NOT NULL AND closed_at > now() - (${dias} || ' days')::interval
        AND counted_cash IS NOT NULL AND ABS(counted_cash - expected_cash) > 100`).catch(() => []);
    for (const f of fechos) findings.push(`💰 Fecho de ${f.opened_by_name} em ${new Date(f.closed_at).toLocaleDateString('pt-PT')}: diferença de ${fmtKz(f.diff)} entre contado e esperado`);
    // 4. stock negativo
    const neg = await this.q<{ name: string; stock_qty: number }>(schema, Prisma.sql`
      SELECT name, stock_qty::float FROM products WHERE is_active = TRUE AND stock_qty < 0 LIMIT 10`);
    for (const n of neg) findings.push(`📦 ${n.name} com stock NEGATIVO (${n.stock_qty}) — vendas sem entrada de stock registada`);
    // 5. saídas de stock manuais (ajustes) sem venda associada
    const ajustes = await this.q<{ n: number }>(schema, Prisma.sql`
      SELECT COUNT(*)::int AS n FROM stock_movements
      WHERE type='OUT' AND (reference IS NULL OR reference NOT ILIKE '%FT%' AND reference NOT ILIKE '%FS%' AND reference NOT ILIKE '%FR%' AND reference NOT ILIKE 'Venda%')
        AND created_at > now() - (${dias} || ' days')::interval`).catch(() => [{ n: 0 }]);
    if (ajustes[0]?.n > 3) findings.push(`📤 ${ajustes[0].n} saídas de stock manuais sem venda associada — confirmar justificativos (transferências/baixas)`);
    return { result: findings.length ? `ANÁLISE ANTI-FRAUDE (${dias} dias) — ${findings.length} indício(s):\n` + findings.join('\n') : `Sem indícios de fraude/quebras nos últimos ${dias} dias: cancelamentos normais, fechos de caixa certos, sem stock negativo nem vendas fora de horas. ✅` };
  }

  private async stockCritico(schema: string): Promise<ToolOutcome> {
    const low = await this.q<{ name: string; quantity: number; min_qty: number; store: string }>(schema, Prisma.sql`
      SELECT p.name, si.quantity::float, COALESCE(si.min_qty,0)::float AS min_qty, s.name AS store
      FROM stock_items si JOIN products p ON p.id = si.product_id JOIN stores s ON s.id = si.warehouse_id
      WHERE p.is_active = TRUE AND si.min_qty IS NOT NULL AND si.quantity <= si.min_qty ORDER BY si.quantity LIMIT 15`).catch(() => []);
    const exp = await this.q<{ name: string; expiry_date: Date; quantity: number }>(schema, Prisma.sql`
      SELECT p.name, b.expiry_date, b.quantity::float FROM product_batches b JOIN products p ON p.id = b.product_id
      WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date < now() + interval '60 days' ORDER BY b.expiry_date LIMIT 10`).catch(() => []);
    const parts: string[] = [];
    if (low.length) parts.push('Stock no mínimo/abaixo: ' + low.map((l) => `${l.name} (${l.quantity} ≤ min ${l.min_qty}, ${l.store})`).join(' · '));
    if (exp.length) parts.push('Validade <60 dias: ' + exp.map((e) => `${e.name} (${e.quantity} un até ${new Date(e.expiry_date).toLocaleDateString('pt-PT')})`).join(' · '));
    return { result: parts.join('\n') || 'Sem alertas de stock: níveis acima do mínimo e sem validades próximas. ✅' };
  }

  private async lucro(schema: string, dias: number): Promise<ToolOutcome> {
    const v = await this.q<{ receita: number; custo: number }>(schema, Prisma.sql`
      SELECT COALESCE(SUM(ii.gross_amount),0)::float AS receita, COALESCE(SUM(ii.quantity * COALESCE(ii.unit_cost,0)),0)::float AS custo
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status='N' AND i.doc_type IN ('FT','FS','FR') AND i.system_entry_date > now() - (${dias} || ' days')::interval`);
    const g = await this.q<{ gastos: number }>(schema, Prisma.sql`
      SELECT COALESCE(SUM(amount),0)::float AS gastos FROM expenses WHERE expense_date > now() - (${dias} || ' days')::interval`).catch(() => [{ gastos: 0 }]);
    const bruto = v[0].receita - v[0].custo;
    const liquido = bruto - g[0].gastos;
    return { result: `Lucro (${dias}d): receita ${fmtKz(v[0].receita)} − custo mercadoria ${fmtKz(v[0].custo)} = bruto ${fmtKz(bruto)}; − gastos ${fmtKz(g[0].gastos)} = LÍQUIDO ${fmtKz(liquido)} (margem ${v[0].receita ? Math.round((liquido / v[0].receita) * 100) : 0}%).` };
  }

  private async gastos(schema: string, dias: number): Promise<ToolOutcome> {
    const rows = await this.q<{ category: string; total: number; n: number }>(schema, Prisma.sql`
      SELECT COALESCE(category,'OUTROS') AS category, COALESCE(SUM(amount),0)::float AS total, COUNT(*)::int AS n
      FROM expenses WHERE expense_date > now() - (${dias} || ' days')::interval GROUP BY 1 ORDER BY total DESC`).catch(() => []);
    return { result: rows.length ? `Gastos (${dias}d): ` + rows.map((r) => `${r.category}: ${fmtKz(r.total)} (${r.n})`).join(' · ') : 'Sem gastos registados no período.' };
  }

  private async funcionarios(schema: string): Promise<ToolOutcome> {
    const rows = await this.q<{ full_name: string; role_title: string; phone: string; base_salary: number }>(schema, Prisma.sql`
      SELECT full_name, COALESCE(role_title,'') AS role_title, COALESCE(phone,'') AS phone, COALESCE(base_salary,0)::float AS base_salary
      FROM employees WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY full_name LIMIT 50`).catch(() => []);
    return { result: rows.length ? 'Funcionários: ' + rows.map((r) => `${r.full_name}${r.role_title ? ` (${r.role_title})` : ''}${r.phone ? ` tel ${r.phone}` : ''}${r.base_salary ? ` salário ${fmtKz(r.base_salary)}` : ''}`).join(' · ') : 'Sem funcionários registados.' };
  }

  private async clientes(schema: string, limite: number): Promise<ToolOutcome> {
    const rows = await this.q<{ name: string; phone: string; email: string }>(schema, Prisma.sql`
      SELECT name, COALESCE(phone,'') AS phone, COALESCE(email,'') AS email FROM customers
      WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY name LIMIT ${Math.min(100, limite)}`);
    return { result: rows.length ? `Clientes (${rows.length}): ` + rows.map((r) => `${r.name}${r.phone ? ` tel ${r.phone}` : ''}${r.email ? ` ${r.email}` : ''}`).join(' · ') : 'Sem clientes registados.' };
  }

  private async mapaIva(schema: string, ano?: number, mes?: number): Promise<ToolOutcome> {
    const now = new Date();
    const y = ano && ano > 2000 ? ano : now.getFullYear();
    const m = mes && mes >= 1 && mes <= 12 ? mes : now.getMonth() + 1;
    const rows = await this.q<{ iva_code: string; base: number; iva: number }>(schema, Prisma.sql`
      SELECT ii.iva_code, COALESCE(SUM(ii.net_amount),0)::float AS base, COALESCE(SUM(ii.iva_amount),0)::float AS iva
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status='N' AND EXTRACT(year FROM i.system_entry_date)=${y} AND EXTRACT(month FROM i.system_entry_date)=${m}
      GROUP BY 1 ORDER BY 1`);
    return { result: rows.length ? `Mapa de IVA ${String(m).padStart(2, '0')}/${y}: ` + rows.map((r) => `${r.iva_code}: base ${fmtKz(r.base)}, IVA ${fmtKz(r.iva)}`).join(' · ') : `Sem documentos em ${String(m).padStart(2, '0')}/${y}.` };
  }

  // ── escrita restrita (auditada; NUNCA elimina) ──────────────
  private async findProduct(schema: string, ident: string): Promise<{ id: string; name: string; unit_price: number } | null> {
    const rows = await this.q<{ id: string; name: string; unit_price: number }>(schema, Prisma.sql`
      SELECT id, name, unit_price::float FROM products
      WHERE is_active = TRUE AND (code = ${ident} OR barcode = ${ident} OR LOWER(name) = LOWER(${ident}) OR name ILIKE ${'%' + ident + '%'})
      ORDER BY (LOWER(name) = LOWER(${ident})) DESC LIMIT 2`);
    return rows.length === 1 ? rows[0] : rows.length > 1 && rows[0].name.toLowerCase() === ident.toLowerCase() ? rows[0] : rows[0] ?? null;
  }

  private async atualizarPreco(schema: string, actor: { id: string; email: string }, ident: string, preco: number): Promise<ToolOutcome> {
    if (!Number.isFinite(preco) || preco <= 0) return { result: 'Preço inválido (tem de ser > 0). Nada alterado.' };
    const p = await this.findProduct(schema, ident);
    if (!p) return { result: `Produto «${ident}» não encontrado. Nada alterado.` };
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE products SET unit_price = ${preco}, updated_at = now() WHERE id = ${p.id}::uuid`));
    await this.audit.record({ actorType: 'TENANT', actorId: actor.id, tenantSchema: schema, action: 'AGENT_UPDATE_PRICE', entity: 'Product', entityId: p.id, before: { unit_price: p.unit_price }, after: { unit_price: preco, by: 'assistente IA', user: actor.email } });
    return { result: `Preço de «${p.name}» alterado de ${fmtKz(p.unit_price)} para ${fmtKz(preco)} (registado na auditoria).` };
  }

  private async criarCliente(schema: string, actor: { id: string; email: string }, args: Record<string, unknown>): Promise<ToolOutcome> {
    const nome = String(args?.nome ?? '').trim().slice(0, 150);
    if (!nome) return { result: 'Nome do cliente em falta.' };
    const rows = await this.q<{ id: string }>(schema, Prisma.sql`
      INSERT INTO customers (name, phone, email) VALUES (${nome}, ${String(args?.telefone ?? '') || null}, ${String(args?.email ?? '') || null}) RETURNING id`);
    await this.audit.record({ actorType: 'TENANT', actorId: actor.id, tenantSchema: schema, action: 'AGENT_CREATE_CUSTOMER', entity: 'Customer', entityId: rows[0].id, after: { nome, by: 'assistente IA' } });
    return { result: `Cliente «${nome}» criado. ✅` };
  }

  /** CRIA um produto REAL no catálogo (reutiliza a criação oficial: grava em
   *  products + stock_items em todas as lojas + movimento de saldo inicial). */
  private async criarProduto(schema: string, actor: { id: string; email: string; storeId?: string | null }, args: Record<string, unknown>): Promise<ToolOutcome> {
    const nome = String(args?.nome ?? '').trim().slice(0, 200);
    const preco = Number(args?.preco);
    if (!nome) return { result: 'Falta o nome do produto. Nada criado.' };
    if (!Number.isFinite(preco) || preco < 0) return { result: 'Preço inválido. Indica o preço de venda em Kz. Nada criado.' };
    const custo = Number(args?.custo);
    const stockInicial = Number(args?.stock_inicial);
    // IVA: usa o indicado se válido, senão o padrão da empresa.
    const ivaIn = String(args?.iva ?? '').toUpperCase().trim();
    const ivaCode: IvaCode = ['NOR', 'INT', 'RED', 'ISE', 'OUT'].includes(ivaIn)
      ? (ivaIn as IvaCode)
      : await this.pos.defaultIvaCode(schema);
    // Código: o indicado ou um EAN-13 interno (prefixo 200 = uso interno GS1).
    const code = String(args?.codigo ?? '').trim()
      || `200${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
    const product = await this.pos.createProduct(schema, {
      code,
      name: nome,
      ivaCode,
      unitPrice: preco,
      costPrice: Number.isFinite(custo) && custo > 0 ? custo : 0,
      stockQty: Number.isFinite(stockInicial) && stockInicial > 0 ? stockInicial : 0,
      // Mesma regra do formulário: o stock inicial entra na LOJA de quem cria
      // (se tiver loja atribuída); sem loja → loja principal. Evita o stock ir
      // para a loja principal e o gestor/operador de outra loja ver 0.
      initialStoreId: actor.storeId ?? null,
    });
    await this.audit.record({ actorType: 'TENANT', actorId: actor.id, tenantSchema: schema, action: 'AGENT_CREATE_PRODUCT', entity: 'Product', entityId: product.id, after: { nome, preco, code, ivaCode, by: 'assistente IA', user: actor.email } });
    const extra = (Number.isFinite(stockInicial) && stockInicial > 0) ? `, stock inicial ${stockInicial}` : '';
    return { result: `Produto «${nome}» criado no catálogo (código ${code}, preço ${fmtKz(preco)}, IVA ${ivaCode}${extra}). Já aparece no caixa, na loja e no inventário. ✅` };
  }

  private async criarDespesa(schema: string, actor: { id: string; email: string }, args: Record<string, unknown>): Promise<ToolOutcome> {
    const desc = String(args?.descricao ?? '').trim().slice(0, 200);
    const valor = Number(args?.valor);
    if (!desc || !Number.isFinite(valor) || valor <= 0) return { result: 'Descrição/valor inválidos. Nada registado.' };
    const cat = String(args?.categoria ?? 'OUTROS').toUpperCase().slice(0, 40);
    const rows = await this.q<{ id: string }>(schema, Prisma.sql`
      INSERT INTO expenses (description, amount, category, expense_date) VALUES (${desc}, ${valor}, ${cat}, now()) RETURNING id`);
    await this.audit.record({ actorType: 'TENANT', actorId: actor.id, tenantSchema: schema, action: 'AGENT_CREATE_EXPENSE', entity: 'Expense', entityId: rows[0].id, after: { desc, valor, by: 'assistente IA' } });
    return { result: `Despesa «${desc}» de ${fmtKz(valor)} registada (${cat}).` };
  }

  private async ajustarMinimo(schema: string, actor: { id: string; email: string }, ident: string, minimo: number): Promise<ToolOutcome> {
    if (!Number.isFinite(minimo) || minimo < 0) return { result: 'Mínimo inválido.' };
    const p = await this.findProduct(schema, ident);
    if (!p) return { result: `Produto «${ident}» não encontrado.` };
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE stock_items SET min_qty = ${minimo} WHERE product_id = ${p.id}::uuid`));
    await this.audit.record({ actorType: 'TENANT', actorId: actor.id, tenantSchema: schema, action: 'AGENT_SET_MIN_STOCK', entity: 'Product', entityId: p.id, after: { minimo, by: 'assistente IA' } });
    return { result: `Stock mínimo de «${p.name}» definido para ${minimo} (todas as lojas).` };
  }

  // ── saídas ──────────────────────────────────────────────────
  private planilha(args: Record<string, unknown>): ToolOutcome {
    const titulo = String(args?.titulo ?? 'planilha').replace(/[^\wÀ-ɏ -]/g, '').slice(0, 60) || 'planilha';
    const colunas = (args?.colunas as string[]) ?? [];
    const linhas = (args?.linhas as string[][]) ?? [];
    const ws = XLSX.utils.aoa_to_sheet([colunas, ...linhas.slice(0, 2000)]);
    ws['!cols'] = colunas.map((c, i) => ({ wch: Math.max(12, String(c).length + 2, ...linhas.slice(0, 50).map((l) => String(l?.[i] ?? '').length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');
    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    return { result: `Planilha «${titulo}.xlsx» criada com ${linhas.length} linhas — anexada para download.`, file: { kind: 'xlsx', name: `${titulo}.xlsx`, base64, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } };
  }

  private pdf(args: Record<string, unknown>): Promise<ToolOutcome> {
    const titulo = String(args?.titulo ?? 'documento').slice(0, 90);
    const paragrafos = ((args?.paragrafos as string[]) ?? []).slice(0, 60);
    const cols = (args?.tabela_colunas as string[]) ?? [];
    const rows = ((args?.tabela_linhas as string[][]) ?? []).slice(0, 300);
    return new Promise((resolve) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => {
        const base64 = Buffer.concat(chunks).toString('base64');
        resolve({ result: `PDF «${titulo}.pdf» criado — anexado para download.`, file: { kind: 'pdf', name: `${titulo.replace(/[^\wÀ-ɏ -]/g, '').slice(0, 60) || 'documento'}.pdf`, base64, mime: 'application/pdf' } });
      });
      doc.fontSize(19).fillColor('#0f1729').text(titulo, { align: 'left' });
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#5a6679').text(`Ndombaxi System · ${new Date().toLocaleDateString('pt-PT')}`);
      doc.moveTo(48, doc.y + 6).lineTo(547, doc.y + 6).strokeColor('#2563eb').lineWidth(2).stroke();
      doc.moveDown(1);
      doc.fontSize(11).fillColor('#1c2436');
      for (const p of paragrafos) { doc.text(String(p), { lineGap: 3 }); doc.moveDown(0.5); }
      if (cols.length && rows.length) {
        doc.moveDown(0.5);
        const w = (547 - 48) / cols.length;
        const y0 = doc.y;
        doc.rect(48, y0, 547 - 48, 20).fill('#eef2fb');
        doc.fillColor('#0f1729').fontSize(9.5);
        cols.forEach((c, i) => doc.text(String(c), 52 + i * w, y0 + 5, { width: w - 8, ellipsis: true }));
        let y = y0 + 22;
        doc.fontSize(9).fillColor('#1c2436');
        for (const r of rows) {
          if (y > 770) { doc.addPage(); y = 60; }
          cols.forEach((_, i) => doc.text(String(r?.[i] ?? ''), 52 + i * w, y, { width: w - 8, ellipsis: true }));
          doc.moveTo(48, y + 14).lineTo(547, y + 14).strokeColor('#e7eaf2').lineWidth(0.5).stroke();
          y += 17;
        }
      }
      doc.end();
    });
  }

  /** Imagem via Gemini (usa a MESMA chave do provedor CHAT configurado). */
  private async imagem(descricao: string): Promise<ToolOutcome> {
    if (!descricao) return { result: 'Descrição da imagem em falta.' };
    const resolved = await this.aiCfg.resolveForCapability('CHAT');
    if (!resolved?.apiKey || !resolved.provider.baseUrl.includes('googleapis')) {
      return { result: 'Geração de imagens precisa do provedor Gemini configurado no painel de IA.' };
    }
    // descobre os modelos de imagem REALMENTE disponíveis nesta chave
    let candidates = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-2.0-flash-preview-image-generation'];
    try {
      const ml = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
        headers: { 'x-goog-api-key': resolved.apiKey }, signal: AbortSignal.timeout(15_000),
      });
      if (ml.ok) {
        const j = (await ml.json()) as { models?: { name?: string }[] };
        const avail = (j.models ?? []).map((m) => String(m.name ?? '').replace('models/', '')).filter((n) => n.includes('image'));
        if (avail.length) candidates = [...avail.filter((a) => candidates.includes(a)), ...avail.filter((a) => !candidates.includes(a))];
      }
    } catch { /* usa a lista fixa */ }
    let lastErr = '';
    for (const model of candidates.slice(0, 4)) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': resolved.apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: descricao }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) { lastErr = `${model}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`; continue; }
        const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
        const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
        if (data) return { result: `Imagem gerada (${model}) — anexada.`, imageBase64: data };
        lastErr = `${model}: sem imagem na resposta`;
      } catch (e) { lastErr = `${model}: ${(e as Error).message?.slice(0, 80)}`; }
    }
    return { result: `Não consegui gerar a imagem agora (${lastErr || 'modelos indisponíveis'}). A quota grátis de imagens pode ter limites por minuto — tenta daqui a pouco.` };
  }

  /** WhatsApp: Meta Cloud API quando configurado; senão link wa.me pronto. */
  private async whatsapp(schema: string, actor: { id: string; email: string }, para: string, mensagem: string): Promise<ToolOutcome> {
    if (!para || !mensagem) return { result: 'Destinatário/mensagem em falta.' };
    // resolve número: direto, funcionário ou cliente (pelo nome)
    let numero = para.replace(/[^\d+]/g, '');
    let quem = para;
    if (numero.length < 9) {
      const emp = await this.q<{ full_name: string; phone: string }>(schema, Prisma.sql`
        SELECT full_name, phone FROM employees WHERE phone IS NOT NULL AND full_name ILIKE ${'%' + para + '%'} LIMIT 1`).catch(() => []);
      const cli = emp.length ? [] : await this.q<{ name: string; phone: string }>(schema, Prisma.sql`
        SELECT name, phone FROM customers WHERE phone IS NOT NULL AND name ILIKE ${'%' + para + '%'} LIMIT 1`).catch(() => []);
      if (emp.length) { numero = emp[0].phone.replace(/[^\d+]/g, ''); quem = emp[0].full_name; }
      else if (cli.length) { numero = cli[0].phone.replace(/[^\d+]/g, ''); quem = cli[0].name; }
      else return { result: `Não encontrei telefone para «${para}» (nem funcionário nem cliente). Indica o número com indicativo.` };
    }
    if (!numero.startsWith('+') && !numero.startsWith('244') && numero.length === 9) numero = '244' + numero;
    numero = numero.replace(/^\+/, '');

    const integ = await this.integrations.getActive('WHATSAPP');
    if (integ?.secret && integ.settings?.phoneNumberId) {
      const res = await fetch(`https://graph.facebook.com/v20.0/${integ.settings.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${integ.secret}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: numero, type: 'text', text: { body: mensagem.slice(0, 3500) } }),
        signal: AbortSignal.timeout(20_000),
      });
      const ok = res.ok;
      await this.audit.record({ actorType: 'TENANT', actorId: actor.id, tenantSchema: schema, action: 'AGENT_WHATSAPP_SENT', after: { para: quem, numero, ok, by: 'assistente IA' } });
      if (ok) return { result: `Mensagem WhatsApp ENVIADA a ${quem} (${numero}). ✅` };
      const detail = await res.text().catch(() => '');
      return { result: `O envio direto falhou (${res.status}: ${detail.slice(0, 140)}). Link manual pronto.`, waLink: `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` };
    }
    return { result: `Integração Meta não configurada — preparei o link wa.me para ${quem} (${numero}): basta clicar para enviar.`, waLink: `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` };
  }
}
