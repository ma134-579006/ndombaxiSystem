// Tipos partilhados entre apps do monorepo NEXUS ERP.

export type RoleName =
  | 'SUPER_ADMIN'
  | 'COMPANY_ADMIN'
  | 'REGIONAL_MANAGER'
  | 'STORE_MANAGER'
  | 'SHIFT_SUPERVISOR'
  | 'CASHIER'
  | 'ATTENDANT';

export type SubjectType = 'PLATFORM' | 'TENANT';

/** Payload do access token JWT. */
export interface JwtPayload {
  sub: string; // id do utilizador (platform ou tenant)
  email: string;
  name?: string; // nome do utilizador (identificação no recibo/relatórios)
  role: RoleName;
  subjectType: SubjectType;
  tenantId?: string; // Company.id (apenas TENANT)
  tenantSchema?: string; // schema PostgreSQL do tenant
  storeId?: string;
  storeName?: string; // nome da loja do operador (mostrado no caixa)
  twoFaVerified: boolean;
}

/** Formato padronizado de erro da API (regra #6 do Prompt Mestre). */
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path?: string;
}

export type CompanyStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type PlanTier = 'STARTER' | 'BUSINESS' | 'ENTERPRISE' | 'WHITE_LABEL';
