import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { JwtPayload } from '@nexus/types';
import { AiConfigService } from './ai-config.service';
import { AiProviderClient, type AgentMessage, type AgentReply } from './ai-provider.client';
import { AgentToolsService, type ToolOutcome } from './agent-tools.service';

/**
 * AGENTE IA do gestor — nível enterprise:
 * loop de raciocínio com FERRAMENTAS REAIS (function-calling) sobre os dados
 * da própria empresa, com eventos em tempo real (SSE) para o painel de
 * atividade do frontend (estilo Claude).
 *
 * Segurança: ferramentas de escrita são whitelisted (NUNCA eliminar),
 * auditadas, e o número de rondas é limitado.
 */

export interface AgentEvent {
  type: 'step_start' | 'step_done' | 'text' | 'attachment' | 'done' | 'error';
  /** step_start/step_done */
  tool?: string;
  args?: Record<string, unknown>;
  summary?: string;
  /** text/done */
  text?: string;
  /** attachment */
  file?: { kind: string; name: string; base64: string; mime: string };
  imageBase64?: string;
  guideUrl?: string;
  waLink?: string;
}

const MAX_ROUNDS = 8;

const AGENT_RULES = `
És o AGENTE do Ndombaxi System dentro do painel do GESTOR — um analista de negócio sénior que EXECUTA, não só fala.

REGRAS DE OURO:
1) Usa SEMPRE as ferramentas para factos (vendas, lucro, stock, funcionários, anomalias) — É PROIBIDO escrever qualquer número, total ou percentagem sem o ter obtido por ferramenta NESTA conversa. Se a pergunta é sobre vendas/lucro/stock/pessoas, a tua PRIMEIRA ação é chamar a ferramenta certa.
1b) Depois de receberes resultados de ferramentas, responde SEMPRE com texto final claro para o gestor (nunca termines em silêncio).
2) Podes CRIAR e ALTERAR dados só pelas ferramentas de escrita disponíveis (criar_produto, criar_cliente, criar_despesa, atualizar_preco_produto, ajustar_stock_minimo). Quando o gestor pedir para CADASTRAR/CRIAR/ADICIONAR um produto, CHAMA SEMPRE a ferramenta criar_produto — É PROIBIDO dizer que criaste sem teres chamado a ferramenta. NÃO existe ferramenta de eliminação — se pedirem para apagar algo, explica que por segurança o agente não elimina nada (o gestor pode desativar no painel).
3) Antes de uma ALTERAÇÃO, se o pedido for ambíguo, confirma o alvo exato; depois executa e reporta o que ficou registado na auditoria.
4) Suspeitas de roubo/quebras/erros: usa detetar_anomalias + desempenho_funcionarios + resumo_vendas e apresenta os INDÍCIOS com prudência (nunca acuses — di-lo como "indício a verificar").
5) Relatórios: oferece criar_planilha ou criar_pdf com os dados reais. Imagens promocionais: criar_imagem. Ensinar fluxos: mostrar_guia. Contactar pessoas: enviar_whatsapp.
6) Responde em português de Angola/Portugal, curto e executivo: começa pela conclusão, depois os números. Usa Markdown simples (negrito, listas).`;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  constructor(
    private readonly cfg: AiConfigService,
    private readonly client: AiProviderClient,
    private readonly tools: AgentToolsService,
  ) {}

  /**
   * Corre o agente, emitindo eventos em tempo real via `emit`.
   * `history` = turnos anteriores (user/assistant) vindos do frontend.
   */
  async run(
    user: JwtPayload,
    history: { role: 'user' | 'assistant'; content: string }[],
    emit: (e: AgentEvent) => void,
  ): Promise<void> {
    const schema = user.tenantSchema;
    if (!schema) throw new BadRequestException('O agente só está disponível dentro de uma empresa.');
    const providers = await this.cfg.resolveAllForCapability('CHAT');
    if (providers.length === 0) throw new BadRequestException('Nenhum provedor de IA configurado (painel do Super Admin → Inteligência Artificial).');
    // Failover: começa no provedor preferido; se falhar (quota/token), migra para
    // o seguinte e mantém-se nele para os turnos seguintes.
    let pi = 0;
    // Erro TRANSITÓRIO do provedor (sobrecarga) — vale a pena repetir o MESMO
    // provedor antes de migrar (o Gemini grátis devolve 503/UNAVAILABLE com
    // frequência quando está cheio).
    const isTransient = (e: unknown): boolean => {
      const m = (e as Error)?.message ?? '';
      return /\b(503|429|500|502|504)\b|unavailable|overloaded|temporarily|rate.?limit|try again/i.test(m);
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const callTools = async (msgs: AgentMessage[], toolDefs: typeof defs): Promise<AgentReply> => {
      let lastErr: unknown = null;
      for (let i = pi; i < providers.length; i++) {
        // até 3 tentativas no mesmo provedor para erros transitórios (backoff)
        for (let attempt = 0; attempt < 3; attempt++) {
          try { const r = await this.client.chatTools(providers[i].provider, providers[i].apiKey, msgs, system, toolDefs); pi = i; return r; }
          catch (e) {
            lastErr = e;
            if (attempt < 2 && isTransient(e)) { await sleep(700 * (attempt + 1)); continue; }
            break; // erro não-transitório ou esgotou tentativas → tenta o próximo provedor
          }
        }
      }
      throw lastErr ?? new Error('Todos os provedores de IA falharam.');
    };

    const persona = await this.cfg.getAssistantConfig();
    const system = `${persona.persona ? persona.persona + '\n' : ''}${AGENT_RULES}\nEMPRESA: ${user.tenantSchema} · UTILIZADOR: ${user.name ?? user.email} (${user.role}). Data de hoje: ${new Date().toLocaleDateString('pt-PT')}.`;

    const messages: AgentMessage[] = history.slice(-16).map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }));
    const defs = this.tools.defs();
    const actor = { id: user.sub, email: user.email };

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const r = await callTools(messages, defs);

      if (!r.toolCalls.length) {
        let text = (r.text ?? '').trim();
        if (!text && round > 0) {
          // alguns modelos devolvem 2.º turno vazio após ferramentas →
          // força um fecho textual com base nos resultados já obtidos
          messages.push({ role: 'user', content: 'Com base nos resultados das ferramentas acima, dá agora a resposta final ao gestor (curta e clara, com os números obtidos).' });
          const r2 = await callTools(messages, []);
          text = (r2.text ?? '').trim() || 'Concluí a análise — os resultados estão no painel de atividade.';
        }
        emit({ type: 'text', text });
        emit({ type: 'done' });
        return;
      }

      // o modelo pode pedir várias ferramentas — executa por ordem
      messages.push({ role: 'assistant', content: r.text ?? '', toolCalls: r.toolCalls });
      for (const call of r.toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.argsJson || '{}'); } catch { /* args malformados → {} */ }
        emit({ type: 'step_start', tool: call.name, args });
        let out: ToolOutcome;
        try {
          out = await this.tools.execute(schema, actor, call.name, args);
        } catch (e) {
          out = { result: `Erro na ferramenta: ${(e as Error).message?.slice(0, 200)}` };
        }
        emit({ type: 'step_done', tool: call.name, summary: out.result.slice(0, 400) });
        if (out.file || out.imageBase64 || out.guideUrl || out.waLink) {
          emit({ type: 'attachment', tool: call.name, file: out.file, imageBase64: out.imageBase64, guideUrl: out.guideUrl, waLink: out.waLink });
        }
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: out.result.slice(0, 6000) });
      }
    }
    emit({ type: 'text', text: 'Cheguei ao limite de passos desta análise — pede-me para continuar que retomo daqui.' });
    emit({ type: 'done' });
  }
}
