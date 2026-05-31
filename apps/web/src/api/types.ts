/** Tipos dos contratos do painel Super Admin. */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
export interface PlatformLoginInput {
  email: string;
  password: string;
  twoFaToken?: string;
}

// ── Empresas (tenants) ───────────────────────────────────────
export type CompanyStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export interface Plan {
  id: string;
  tier: string;
  name: string;
}
export interface Company {
  id: string;
  code: string;
  name: string;
  nif: string;
  iban: string | null;
  responsibleName: string;
  responsibleEmail: string;
  responsiblePhone: string | null;
  sector: string | null;
  status: CompanyStatus;
  schemaName: string;
  customDomain: string | null;
  planId: string;
  plan?: Plan;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── IA ───────────────────────────────────────────────────────
export const AI_ADAPTERS = ['openmanus', 'openai', 'anthropic', 'elevenlabs', 'generic'] as const;
export const AI_CAPABILITIES = ['CHAT', 'TTS', 'STT', 'IMAGE', 'VOICE_CALL'] as const;

export interface AiProvider {
  id: string;
  name: string;
  adapter: string;
  capabilities: string[];
  baseUrl: string;
  model: string | null;
  voice: string | null;
  hasApiKey: boolean;
  apiKeyMask: string | null;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  createdAt: string;
}
export interface CreateProviderInput {
  name: string;
  adapter: string;
  capabilities: string[];
  baseUrl: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  isActive?: boolean;
  isDefault?: boolean;
  priority?: number;
}

export interface AssistantConfig {
  displayName: string;
  persona: string;
  systemPrompt: string | null;
  greeting: string | null;
  locale: string;
  voiceEnabled: boolean;
  callEnabled: boolean;
  imageEnabled: boolean;
  chartsEnabled: boolean;
  emojiLevel: string;
}

// ── Gateways de pagamento ────────────────────────────────────
export const GATEWAY_PROVIDERS = ['EXPRESS', 'EMIS', 'PROXYPAY', 'GENERIC'] as const;
export interface Gateway {
  id: string;
  provider: string;
  label: string;
  contractRef: string | null;
  merchantId: string | null;
  posId: string | null;
  iban: string | null;
  baseUrl: string | null;
  isActive: boolean;
  hasApiKey?: boolean;
  apiKeyMask?: string | null;
  createdAt: string;
}
export interface CreateGatewayInput {
  provider: string;
  label: string;
  contractRef?: string;
  merchantId?: string;
  posId?: string;
  iban?: string;
  baseUrl?: string;
  apiKey?: string;
  isActive?: boolean;
}

// ── Fiscal AGT ───────────────────────────────────────────────
export interface AgtExtraField {
  key: string;
  label: string;
  value: string;
  showOnReceipt?: boolean;
  showOnReport?: boolean;
}
export interface AgtConfig {
  subscribed: boolean;
  subscribedAt: string | null;
  environment: string;
  softwareCertificateNumber: string;
  productId: string;
  productVersion: string;
  sourceId: string;
  taxAccountingBasis: string;
  taxEntity: string;
  saftVersion: string;
  receiptLegend: string | null;
  reportFooter: string | null;
  extraFields: AgtExtraField[];
}
export interface UpdateAgtInput {
  environment?: string;
  softwareCertificateNumber?: string;
  productId?: string;
  productVersion?: string;
  sourceId?: string;
  taxAccountingBasis?: string;
  taxEntity?: string;
  saftVersion?: string;
  receiptLegend?: string;
  reportFooter?: string;
  extraFields?: AgtExtraField[];
}
