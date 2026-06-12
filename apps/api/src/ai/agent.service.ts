import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { JwtPayload } from '@nexus/types';
import { AiConfigService } from './ai-config.service';
import { AiProviderClient, type AgentMessage } from './ai-provider.client';
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
1) Usa SEMPRE as ferramentas para factos (vendas, lucro, stock, funcionários, anomalias) — NUNCA inventes números.
2) Podes ALTERAR dados só pelas ferramentas de escrita disponíveis (preço, cliente, despesa, stock mínimo). NÃO existe ferramenta de eliminação — se pedirem para apagar algo, explica que por segurança o agente não elimina nada (o gestor pode desativar no painel).
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
    const resolved = await this.cfg.resolveForCapability('CHAT');
    if (!resolved) throw new BadRequestException('Nenhum provedor de IA configurado (painel do Super Admin → Inteligência Artificial).');

    const persona = await this.cfg.getAssistantConfig();
    const system = `${persona.persona ? persona.persona + '\n' : ''}${AGENT_RULES}\nEMPRESA: ${user.tenantSchema} · UTILIZADOR: ${user.name ?? user.email} (${user.role}). Data de hoje: ${new Date().toLocaleDateString('pt-PT')}.`;

    const messages: AgentMessage[] = history.slice(-16).map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }));
    const defs = this.tools.defs();
    const actor = { id: user.sub, email: user.email };

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const r = await this.client.chatTools(resolved.provider, resolved.apiKey, messages, system, defs);

      if (!r.toolCalls.length) {
        emit({ type: 'text', text: r.text ?? '' });
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
