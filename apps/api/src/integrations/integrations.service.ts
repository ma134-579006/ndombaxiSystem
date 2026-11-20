import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';

export interface IntegrationFieldDef { name: string; label: string }
export interface IntegrationCatalogEntry {
  key: string;
  label: string;
  description: string;
  hasBaseUrl: boolean;
  baseUrlLabel: string;
  settingsFields: IntegrationFieldDef[];
  secretLabel: string;
}

/** Catálogo das integrações externas configuráveis pelo Super Admin. O código
 *  está pronto: cada uma activa assim que for preenchida e ligada. */
export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  // AGT_SAFT foi REMOVIDA do catálogo: duplicava a página "Fiscal (AGT)" do
  // Super Admin, que é a fonte única (nº de validação, endpoint, credencial,
  // legendas, chave pública). Dados que existissem na linha AGT_SAFT são
  // migrados automaticamente para a config fiscal (ver AgtConfigService.get).
  {
    key: 'OPEN_FINANCE', label: 'Open Finance — Banco',
    description: 'Saldos e movimentos bancários ao vivo (Open Finance).',
    hasBaseUrl: true, baseUrlLabel: 'Endpoint da API do banco',
    settingsFields: [
      { name: 'bankCode', label: 'Banco (código)' },
      { name: 'clientId', label: 'Client ID' },
    ],
    secretLabel: 'Client secret',
  },
  {
    key: 'STRIPE', label: 'Stripe — Cobrança recorrente',
    description: 'Cobrança recorrente das subscrições (cartão internacional).',
    hasBaseUrl: false, baseUrlLabel: '',
    settingsFields: [
      { name: 'publishableKey', label: 'Publishable key' },
      { name: 'webhookId', label: 'Webhook ID' },
    ],
    secretLabel: 'Secret key',
  },
  {
    key: 'DOCUSIGN', label: 'DocuSign — Contratos',
    description: 'Assinatura digital de contratos de subscrição.',
    hasBaseUrl: true, baseUrlLabel: 'Base URL DocuSign',
    settingsFields: [
      { name: 'accountId', label: 'Account ID' },
      { name: 'integrationKey', label: 'Integration key' },
    ],
    secretLabel: 'Chave privada / secret',
  },
  {
    key: 'WHATSAPP', label: 'WhatsApp — Mensagens',
    description: 'Envio de mensagens WhatsApp a funcionários e clientes (Meta Cloud API). Sem token, o assistente gera links wa.me prontos a enviar.',
    hasBaseUrl: false, baseUrlLabel: '',
    settingsFields: [
      { name: 'phoneNumberId', label: 'Phone Number ID (Meta)' },
    ],
    secretLabel: 'Access token (Meta Cloud API)',
  },
  {
    key: 'PUBLIC_WEBCAMS', label: 'Câmaras públicas — Windy Webcams (opcional)',
    description: 'Chave gratuita em api.windy.com/keys (produto "Webcams API"). Sem chave usa só o OpenStreetMap, cujos servidores públicos ficam muitas vezes sobrecarregados.',
    hasBaseUrl: false, baseUrlLabel: '',
    settingsFields: [],
    secretLabel: 'Chave da API (x-windy-api-key)',
  },
  {
    key: 'FACEBOOK_LOGIN', label: 'Facebook Login — Entrar com Facebook',
    description: 'Botão "Entrar com Facebook" do login e do registo (developers.facebook.com → app → Facebook Login, domínio do site autorizado). Cores e textos do botão: Super Admin → Login & Registo.',
    hasBaseUrl: false, baseUrlLabel: '',
    settingsFields: [{ name: 'appId', label: 'App ID' }],
    secretLabel: 'App Secret',
  },
  {
    key: 'BIOMETRIC', label: 'Ponto biométrico',
    description: 'Controlo de assiduidade por dispositivo biométrico.',
    hasBaseUrl: true, baseUrlLabel: 'Endpoint do dispositivo/ponte',
    settingsFields: [
      { name: 'deviceModel', label: 'Modelo do dispositivo' },
      { name: 'location', label: 'Localização' },
    ],
    secretLabel: 'Token do dispositivo',
  },
];

export interface IntegrationView extends IntegrationCatalogEntry {
  enabled: boolean;
  environment: string;
  baseUrl: string | null;
  settings: Record<string, unknown>;
  hasSecret: boolean;
  lastStatus: string | null;
  lastTestAt: Date | null;
}

export interface UpdateIntegrationInput {
  enabled?: boolean;
  environment?: 'TEST' | 'PRODUCTION';
  baseUrl?: string | null;
  settings?: Record<string, unknown>;
  secret?: string; // se vazio/omitido, mantém o existente
}

/** Configuração ACTIVA (com segredo desencriptado) para os adaptadores usarem. */
export interface ActiveIntegration {
  key: string;
  environment: string;
  baseUrl: string | null;
  settings: Record<string, unknown>;
  secret: string | null;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get key(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  private entry(key: string): IntegrationCatalogEntry {
    const e = INTEGRATION_CATALOG.find((c) => c.key === key);
    if (!e) throw new BadRequestException(`Integração desconhecida: ${key}`);
    return e;
  }

  /** Lista todas as integrações (catálogo + estado actual), sem expor segredos. */
  async list(): Promise<IntegrationView[]> {
    const rows = await this.prisma.integration.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return INTEGRATION_CATALOG.map((c) => {
      const r = byKey.get(c.key);
      return {
        ...c,
        enabled: r?.enabled ?? false,
        environment: r?.environment ?? 'TEST',
        baseUrl: r?.baseUrl ?? null,
        settings: (r?.settings as Record<string, unknown>) ?? {},
        hasSecret: !!r?.secretEnc,
        lastStatus: r?.lastStatus ?? null,
        lastTestAt: r?.lastTestAt ?? null,
      };
    });
  }

  async update(key: string, dto: UpdateIntegrationInput): Promise<IntegrationView> {
    const entry = this.entry(key);
    const existing = await this.prisma.integration.findUnique({ where: { key } });
    const secretEnc =
      dto.secret && dto.secret.trim().length > 0
        ? encryptSecret(dto.secret.trim(), this.key)
        : existing?.secretEnc ?? null;

    await this.prisma.integration.upsert({
      where: { key },
      create: {
        key, label: entry.label,
        enabled: dto.enabled ?? false,
        environment: dto.environment ?? 'TEST',
        baseUrl: dto.baseUrl ?? null,
        settings: (dto.settings ?? {}) as object,
        secretEnc,
      },
      update: {
        enabled: dto.enabled ?? existing?.enabled ?? false,
        environment: dto.environment ?? existing?.environment ?? 'TEST',
        baseUrl: dto.baseUrl !== undefined ? dto.baseUrl : existing?.baseUrl ?? null,
        settings: (dto.settings ?? existing?.settings ?? {}) as object,
        secretEnc,
      },
    });
    return (await this.list()).find((v) => v.key === key)!;
  }

  /** Teste de ligação simples (reachability). Guarda o resultado. */
  async test(key: string): Promise<{ ok: boolean; status: string }> {
    const entry = this.entry(key);
    const row = await this.prisma.integration.findUnique({ where: { key } });
    let result: { ok: boolean; status: string };

    if (!row || !row.enabled) {
      result = { ok: false, status: 'Integração desligada' };
    } else if (entry.hasBaseUrl) {
      if (!row.baseUrl) {
        result = { ok: false, status: 'Falta o endpoint (Base URL)' };
      } else if (!isSafePublicUrl(row.baseUrl)) {
        // Defesa SSRF: não deixar o servidor sondar alvos internos/privados.
        result = { ok: false, status: 'URL inválido (use https público, não endereços internos)' };
      } else {
        try {
          const res = await fetch(row.baseUrl, { method: 'GET', signal: AbortSignal.timeout(6000) });
          result = { ok: res.status < 500, status: `Resposta HTTP ${res.status}` };
        } catch (e) {
          result = { ok: false, status: `Sem ligação: ${(e as Error).message}` };
        }
      }
    } else if (key === 'PUBLIC_WEBCAMS' && row.secretEnc) {
      // Teste real: pergunta à Windy com a chave guardada (câmaras perto de Luanda).
      const secret = (await this.getActive(key).catch(() => null))?.secret;
      try {
        const res = await fetch(`${process.env.WINDY_WEBCAMS_URL || 'https://api.windy.com/webcams/api/v3/webcams'}?nearby=-8.8383,13.2344,250&limit=1`, {
          headers: { 'x-windy-api-key': secret ?? '', accept: 'application/json' }, signal: AbortSignal.timeout(8000),
        });
        if (res.status === 401 || res.status === 403) result = { ok: false, status: 'Chave da Windy inválida' };
        else if (!res.ok) result = { ok: false, status: `Windy respondeu HTTP ${res.status}` };
        else {
          const j = (await res.json().catch(() => ({}))) as { total?: number };
          result = { ok: true, status: `Chave válida · ${typeof j.total === 'number' ? j.total : '?'} câmaras até 250 km de Luanda` };
        }
      } catch (e) {
        result = { ok: false, status: `Sem ligação à Windy: ${(e as Error).message}` };
      }
    } else if (key === 'FACEBOOK_LOGIN') {
      // Teste real: pede o app token à Graph API com App ID + App Secret.
      const appId = String((row.settings as Record<string, unknown> | null)?.appId ?? '').trim();
      const secret = (await this.getActive(key).catch(() => null))?.secret;
      if (!appId) result = { ok: false, status: 'Falta o App ID' };
      else if (!secret) result = { ok: false, status: 'Falta o App Secret' };
      else {
        try {
          const g = process.env.FACEBOOK_GRAPH_URL || 'https://graph.facebook.com/v19.0';
          const res = await fetch(`${g}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`, { signal: AbortSignal.timeout(8000) });
          const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
          result = res.ok && j.access_token
            ? { ok: true, status: 'App ID e App Secret válidos' }
            : { ok: false, status: `Facebook recusou: ${j.error?.message ?? `HTTP ${res.status}`}` };
        } catch (e) {
          result = { ok: false, status: `Sem ligação ao Facebook: ${(e as Error).message}` };
        }
      }
    } else {
      result = row.secretEnc
        ? { ok: true, status: 'Credenciais guardadas' }
        : { ok: false, status: 'Faltam credenciais' };
    }

    await this.prisma.integration.update({
      where: { key },
      data: { lastStatus: result.status, lastTestAt: new Date() },
    }).catch(() => undefined);
    return result;
  }

  /**
   * Configuração ACTIVA de uma integração (segredo desencriptado), para os
   * adaptadores. Devolve null se a integração não existir ou estiver desligada.
   */
  async getActive(key: string): Promise<ActiveIntegration | null> {
    const row = await this.prisma.integration.findUnique({ where: { key } });
    if (!row || !row.enabled) return null;
    let secret: string | null = null;
    if (row.secretEnc) {
      try { secret = decryptSecret(row.secretEnc, this.key); }
      catch (e) { this.logger.error(`Falha ao desencriptar segredo de ${key}`, (e as Error).stack); }
    }
    return {
      key: row.key,
      environment: row.environment,
      baseUrl: row.baseUrl,
      settings: (row.settings as Record<string, unknown>) ?? {},
      secret,
    };
  }
}

/**
 * Defesa SSRF: só permite testar URLs http(s) com host público — bloqueia
 * loopback, redes privadas e link-local (ex.: 169.254.169.254 metadata).
 */
function isSafePublicUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  // IPv4 privado / loopback / link-local
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return false;
  }
  // IPv6 loopback / link-local / ULA
  if (host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return false;
  return true;
}
