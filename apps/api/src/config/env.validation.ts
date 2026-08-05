import { z } from 'zod';

/**
 * Zod schema for environment variables.
 * Rule #10 (Prompt Mestre): variáveis de ambiente nunca hard-coded, sempre validadas.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // Motor da base: por omissão PostgreSQL por TCP (nuvem e posto Windows);
  // `pglite` corre a base DENTRO do processo (o modo do telemóvel).
  DATABASE_ENGINE: z.enum(['postgres', 'pglite']).default('postgres'),
  PGLITE_DATA_DIR: z.string().optional(),

  // Num aparelho não há endereço nenhum para onde ligar — por isso o URL só é
  // exigido quando o motor é o PostgreSQL. Continua OBRIGATÓRIO aí: uma API da
  // nuvem a arrancar sem base seria pior do que não arrancar.
  // A variável VAZIA vale por ausente: é o que um aparelho tem, e é também o
  // que sobra quando alguém apaga o valor num painel de configuração.
  DATABASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().or(z.string().startsWith('postgresql://')).optional(),
  ),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  TWOFA_ISSUER: z.string().default('Ndombaxi System'),

  RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_TENANT_PER_MIN: z.coerce.number().int().positive().default(1000),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  SUPER_ADMIN_EMAIL: z.string().email().default('admin@nexus-erp.ao'),
  SUPER_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe!Admin2025'),

  // Chave para encriptar segredos em repouso (ex.: api_keys dos provedores de
  // IA configurados pelo Super Admin). AES-256-GCM → 32 bytes mínimos.
  CONFIG_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default('dev-only-config-encryption-key-change-me-32+'),

  // OpenClaw (github.com/openclaw/openclaw) — gateway com endpoint
  // OpenAI-compatível. Se OPENCLAW_BASE_URL estiver definido, o bot de
  // suporte usa-o como reforço de IA (stateless — nada fica guardado lá).
  OPENCLAW_BASE_URL: z.string().url().optional(),
  OPENCLAW_TOKEN: z.string().optional(),
  OPENCLAW_MODEL: z.string().default('openclaw'),

  // Limites do bot de suporte (proteção de custos e abuso):
  //   • máx. de chamadas à IA externa por conversa/minuto e por dia (global)
  //   • máx. de tokens por resposta
  SUPPORT_AI_MAX_PER_CHAT_MIN: z.coerce.number().int().positive().default(6),
  SUPPORT_AI_MAX_PER_DAY: z.coerce.number().int().positive().default(300),
  SUPPORT_AI_MAX_TOKENS: z.coerce.number().int().positive().default(400),

  // Google Sign-In (OAuth) — Client ID público; o backend verifica o ID token
  // contra as chaves públicas da Google (não precisa de Client Secret).
  GOOGLE_CLIENT_ID: z
    .string()
    .default('522636462932-m67fvuutei11ug355aion1sh00h1k2br.apps.googleusercontent.com'),
})
  // Cada motor tem a SUA exigência, e nenhuma delas pode ficar por verificar:
  // sem endereço, a API da nuvem arrancava sem base; sem pasta, o PGlite
  // guardava tudo em memória e as vendas do dia morriam ao fechar a app.
  .superRefine((env, ctx) => {
    if (env.DATABASE_ENGINE === 'pglite') {
      if (!env.PGLITE_DATA_DIR) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PGLITE_DATA_DIR'],
          message: 'obrigatório quando DATABASE_ENGINE=pglite (pasta onde a base fica gravada)',
        });
      }
    } else if (!env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'obrigatório quando DATABASE_ENGINE=postgres',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
