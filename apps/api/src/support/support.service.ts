import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiConfigService } from '../ai/ai-config.service';
import { AiProviderClient, type ChatTurn } from '../ai/ai-provider.client';

/**
 * SUPORTE DA PLATAFORMA (landing):
 *   • Chat com um assistente IA que conhece TODO o funcionamento do sistema
 *     (conhecimento embutido no prompt — NUNCA acede à base de dados) e
 *     escala para o Super Admin quando não sabe ou quando o visitante pede.
 *   • Comentários públicos (sugestões) com 👍/👎 e painel/estatísticas para o
 *     Super Admin, com notificação de novos comentários.
 *
 * As tabelas vivem no schema PÚBLICO e são criadas de forma idempotente.
 */
const KNOWLEDGE = `
És o assistente oficial do Ndombaxi System — um sistema SaaS de gestão (ERP + POS + loja online) para empresas de Angola, em Kwanzas (Kz).
Respondes SEMPRE em português de Portugal/Angola, de forma profissional, clara e simpática. Usa passos numerados quando ensinas a fazer algo.

O QUE É O SISTEMA (conhece tudo isto):
• Site oficial: https://ndombaxisystem.com (landing, criação de conta, login). Caixa: https://caixa.ndombaxisystem.com. Loja online: https://loja.ndombaxisystem.com.
• Criar conta: na landing → "Criar conta" → dados da empresa → escolher plano → pagar por transferência (IBAN mostrado) → enviar comprovativo (imagem) → o Super Admin aprova e a conta ativa. Há teste grátis.
• Login: gestor entra com código da empresa + email + palavra-passe (ou Google). No caixa, o operador escolhe o NOME e digita o PIN de 6 dígitos.
• Painel do gestor: Visão Geral (dashboard com gráficos), Produtos (criar com código de barras/scanner, preço, IVA, fotos), Entradas de stock/Inventário (entrada com custo total→custo unitário e lucro automático, lotes com validade FEFO, contagens com scanner), Análise/Movimentos de stock, Lojas (multi-loja), Funcionários (RH: ficha, foto, salário, bónus, FALTAS que descontam automaticamente na folha — 1 dia = salário base ÷ 30), Folha Salarial (INSS 3% trabalhador / 8% empresa + IRT automático), Faltas & Férias, Equipa/acessos (papéis e PIN), Encomendas da loja online (com chat com o cliente), Promoções, Gastos, Contas a Receber/Pagar, Fluxo de Caixa, Lucro & Margens (curva ABC), Comissões de vendedores, Reconciliação bancária (CSV), Relatórios (por produto/utilizador/loja/categoria/marca/evolução/IVA/pagamentos/documentos/fecho de caixa, com gráficos e impressão A4 profissional), Fiscal SAF-T AGT (XML mensal), Caixa & Auditoria (registo imutável de tudo), Configurações (logo, dizeres do recibo, senhas/PIN).
• Caixa (POS): funciona offline, vende por toque ou scanner de código de barras (câmara), faturas certificadas AGT (FT/FS/FR/NC) com QR e hash, abrir/fechar turno, Relatório X/Z, histórico e cancelamentos (nota de crédito repõe stock), impressão térmica 80mm/58mm e A4, multi-operador por nome+PIN.
• Loja online: catálogo com fotos e stock em tempo real, carrinho, checkout (transferência/referência/Express), acompanhamento da encomenda, chat com a loja. Criar conta de cliente é obrigatório para comprar e ver o histórico.
• Stock é por LOJA, com transferências entre lojas e alertas de stock mínimo e validade.
• Planos e preços: definidos pelo Super Admin; pagamento por transferência com envio de comprovativo. Cada plano limita lojas/utilizadores/produtos.
• Temas: Claro (padrão), Profissional, Apple Dark, Meia-noite, Néon e outros — mudam no seletor do topo. Impressões saem sempre em formato profissional com logo, NIF e dizeres da empresa.
• Segurança: RBAC com 7 níveis, 2FA opcional, auditoria imutável com hash encadeado, logout automático por inatividade (15 min) com restauro do trabalho ao voltar a entrar.

REGRAS:
1) NUNCA inventes funcionalidades que não estão na lista. NUNCA digas que tens acesso a dados de clientes — não tens acesso à base de dados.
2) Se a pergunta fugir do sistema (ex.: política, programação geral), redireciona com simpatia para temas do sistema.
3) Se não souberes responder com confiança, ou se o visitante pedir um humano/comercial/preços especiais/problemas de pagamento, termina a resposta com a etiqueta exata: [CHAMAR_ADMIN]
`;

export interface SupportMessage { id: string; sender: 'VISITOR' | 'BOT' | 'ADMIN'; body: string; created_at: Date }

@Injectable()
export class SupportService implements OnModuleInit {
  private readonly logger = new Logger(SupportService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiCfg: AiConfigService,
    private readonly ai: AiProviderClient,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.support_chats (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          visitor_name TEXT,
          status TEXT NOT NULL DEFAULT 'BOT',
          unread_admin INT NOT NULL DEFAULT 0,
          last_msg_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.support_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chat_id UUID NOT NULL REFERENCES public.support_chats(id) ON DELETE CASCADE,
          sender TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.site_feedback (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          author_name TEXT NOT NULL,
          body TEXT NOT NULL,
          likes INT NOT NULL DEFAULT 0,
          dislikes INT NOT NULL DEFAULT 0,
          seen_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    } catch (e) {
      this.logger.error('Falha a garantir tabelas de suporte', e instanceof Error ? e.stack : undefined);
    }
  }

  // ── Chat (lado público) ─────────────────────────────────────
  async createChat(visitorName?: string): Promise<{ chatId: string; greeting: string }> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO public.support_chats (visitor_name) VALUES (${visitorName?.slice(0, 80) ?? null}) RETURNING id`,
    );
    const greeting = `Olá${visitorName ? `, ${visitorName}` : ''}! 👋 Sou o assistente do Ndombaxi System. Pergunta-me como criar conta, vender no caixa, gerir stock, folha salarial, relatórios… Se precisares, chamo a nossa equipa.`;
    await this.prisma.$executeRaw(
      Prisma.sql`INSERT INTO public.support_messages (chat_id, sender, body) VALUES (${rows[0].id}::uuid, 'BOT', ${greeting})`,
    );
    return { chatId: rows[0].id, greeting };
  }

  async sendVisitorMessage(chatId: string, body: string): Promise<{ reply: string; escalated: boolean }> {
    const text = (body ?? '').trim().slice(0, 1500);
    if (!text) throw new BadRequestException('Mensagem vazia.');
    const chat = await this.getChat(chatId);
    const count = await this.prisma.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM public.support_messages WHERE chat_id = ${chatId}::uuid`,
    );
    if ((count[0]?.n ?? 0) > 120) throw new BadRequestException('Esta conversa atingiu o limite. Abre uma nova.');

    await this.prisma.$executeRaw(
      Prisma.sql`INSERT INTO public.support_messages (chat_id, sender, body) VALUES (${chatId}::uuid, 'VISITOR', ${text})`,
    );

    // Já em modo humano → não responde o bot; o Super Admin verá a mensagem.
    if (chat.status === 'HUMAN') {
      await this.bumpUnread(chatId);
      return { reply: '', escalated: true };
    }

    // Histórico (últimas 12 mensagens) para contexto do bot.
    const history = await this.prisma.$queryRaw<SupportMessage[]>(
      Prisma.sql`SELECT id, sender, body, created_at FROM public.support_messages
                 WHERE chat_id = ${chatId}::uuid ORDER BY created_at DESC LIMIT 12`,
    );
    const turns: ChatTurn[] = history.reverse().map((m) => ({
      role: m.sender === 'VISITOR' ? 'user' as const : 'assistant' as const,
      content: m.body,
    }));

    let reply: string;
    let escalated = false;
    try {
      const resolved = await this.aiCfg.resolveForCapability('CHAT');
      if (!resolved) throw new Error('sem provedor');
      const r = await this.ai.chat(resolved.provider, resolved.apiKey, turns, KNOWLEDGE);
      reply = (r.text || '').trim();
      if (!reply) throw new Error('resposta vazia');
      if (reply.includes('[CHAMAR_ADMIN]')) {
        escalated = true;
        reply = reply.replace('[CHAMAR_ADMIN]', '').trim()
          + '\n\n🔔 Chamei a nossa equipa — o Super Admin vai responder-te aqui mesmo, em breve.';
      }
    } catch {
      // Sem IA configurada/disponível → escala logo para humano (nunca deixa sem resposta).
      escalated = true;
      reply = 'Obrigado pela mensagem! 🙏 Chamei a nossa equipa — o Super Admin vai responder-te aqui mesmo, em breve.';
    }

    await this.prisma.$executeRaw(
      Prisma.sql`INSERT INTO public.support_messages (chat_id, sender, body) VALUES (${chatId}::uuid, 'BOT', ${reply})`,
    );
    if (escalated) {
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE public.support_chats SET status = 'HUMAN', last_msg_at = now() WHERE id = ${chatId}::uuid`,
      );
      await this.bumpUnread(chatId);
    } else {
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE public.support_chats SET last_msg_at = now() WHERE id = ${chatId}::uuid`,
      );
    }
    return { reply, escalated };
  }

  async listMessages(chatId: string, afterIso?: string): Promise<SupportMessage[]> {
    await this.getChat(chatId);
    if (afterIso && !Number.isNaN(Date.parse(afterIso))) {
      return this.prisma.$queryRaw<SupportMessage[]>(
        Prisma.sql`SELECT id, sender, body, created_at FROM public.support_messages
                   WHERE chat_id = ${chatId}::uuid AND created_at > ${afterIso}::timestamptz
                   ORDER BY created_at ASC LIMIT 100`,
      );
    }
    return this.prisma.$queryRaw<SupportMessage[]>(
      Prisma.sql`SELECT id, sender, body, created_at FROM public.support_messages
                 WHERE chat_id = ${chatId}::uuid ORDER BY created_at ASC LIMIT 200`,
    );
  }

  private async getChat(chatId: string): Promise<{ id: string; status: string }> {
    const rows = await this.prisma.$queryRaw<{ id: string; status: string }[]>(
      Prisma.sql`SELECT id, status FROM public.support_chats WHERE id = ${chatId}::uuid LIMIT 1`,
    );
    if (!rows[0]) throw new NotFoundException('Conversa não encontrada.');
    return rows[0];
  }

  private async bumpUnread(chatId: string): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE public.support_chats SET unread_admin = unread_admin + 1, last_msg_at = now() WHERE id = ${chatId}::uuid`,
    );
  }

  // ── Chat (lado Super Admin) ─────────────────────────────────
  listChats(): Promise<unknown[]> {
    return this.prisma.$queryRaw(
      Prisma.sql`SELECT c.id, c.visitor_name, c.status, c.unread_admin, c.last_msg_at, c.created_at,
                        (SELECT body FROM public.support_messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
                 FROM public.support_chats c
                 ORDER BY (c.status = 'HUMAN') DESC, c.unread_admin DESC, c.last_msg_at DESC
                 LIMIT 200`,
    );
  }

  async adminReply(chatId: string, body: string): Promise<void> {
    const text = (body ?? '').trim().slice(0, 3000);
    if (!text) throw new BadRequestException('Mensagem vazia.');
    await this.getChat(chatId);
    await this.prisma.$executeRaw(
      Prisma.sql`INSERT INTO public.support_messages (chat_id, sender, body) VALUES (${chatId}::uuid, 'ADMIN', ${text})`,
    );
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE public.support_chats SET status = 'HUMAN', unread_admin = 0, last_msg_at = now() WHERE id = ${chatId}::uuid`,
    );
  }

  async markRead(chatId: string): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE public.support_chats SET unread_admin = 0 WHERE id = ${chatId}::uuid`,
    );
  }

  async closeChat(chatId: string): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE public.support_chats SET status = 'CLOSED', unread_admin = 0 WHERE id = ${chatId}::uuid`,
    );
  }

  /** Notificações (sino): conversas com mensagens por ler + comentários novos. */
  async notifications(): Promise<{ unreadChats: number; humanWaiting: number; newFeedback: number }> {
    const a = await this.prisma.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM public.support_chats WHERE unread_admin > 0`,
    );
    const b = await this.prisma.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM public.support_chats WHERE status = 'HUMAN' AND unread_admin > 0`,
    );
    const c = await this.prisma.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM public.site_feedback WHERE seen_by_admin = FALSE`,
    );
    return { unreadChats: a[0]?.n ?? 0, humanWaiting: b[0]?.n ?? 0, newFeedback: c[0]?.n ?? 0 };
  }

  // ── Comentários públicos (sugestões) ────────────────────────
  async addFeedback(authorName: string, body: string): Promise<{ id: string }> {
    const name = (authorName ?? '').trim().slice(0, 80) || 'Anónimo';
    const text = (body ?? '').trim().slice(0, 1200);
    if (text.length < 3) throw new BadRequestException('Escreve o teu comentário.');
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO public.site_feedback (author_name, body) VALUES (${name}, ${text}) RETURNING id`,
    );
    return { id: rows[0].id };
  }

  listFeedback(limit = 50): Promise<unknown[]> {
    return this.prisma.$queryRaw(
      Prisma.sql`SELECT id, author_name, body, likes, dislikes, created_at
                 FROM public.site_feedback ORDER BY created_at DESC LIMIT ${Math.min(limit, 200)}`,
    );
  }

  async vote(id: string, dir: 'up' | 'down'): Promise<{ likes: number; dislikes: number }> {
    const col = dir === 'up' ? Prisma.sql`likes = likes + 1` : Prisma.sql`dislikes = dislikes + 1`;
    const rows = await this.prisma.$queryRaw<{ likes: number; dislikes: number }[]>(
      Prisma.sql`UPDATE public.site_feedback SET ${col} WHERE id = ${id}::uuid RETURNING likes, dislikes`,
    );
    if (!rows[0]) throw new NotFoundException('Comentário não encontrado.');
    return rows[0];
  }

  /** Painel do Super Admin: lista completa + estatísticas para o dashboard. */
  async feedbackAdmin(): Promise<{ items: unknown[]; stats: { total: number; positive: number; negative: number; neutral: number; perDay: { day: string; count: number }[] } }> {
    const items = (await this.prisma.$queryRaw(
      Prisma.sql`SELECT id, author_name, body, likes, dislikes, seen_by_admin, created_at
                 FROM public.site_feedback ORDER BY created_at DESC LIMIT 300`,
    )) as Array<{ likes: number; dislikes: number }>;
    const perDay = (await this.prisma.$queryRaw(
      Prisma.sql`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
                 FROM public.site_feedback
                 WHERE created_at > now() - interval '30 days'
                 GROUP BY 1 ORDER BY 1`,
    )) as { day: string; count: number }[];
    let positive = 0, negative = 0, neutral = 0;
    for (const f of items) {
      if (f.likes > f.dislikes) positive++;
      else if (f.dislikes > f.likes) negative++;
      else neutral++;
    }
    await this.prisma.$executeRaw(Prisma.sql`UPDATE public.site_feedback SET seen_by_admin = TRUE WHERE seen_by_admin = FALSE`);
    return { items, stats: { total: items.length, positive, negative, neutral, perDay } };
  }
}
