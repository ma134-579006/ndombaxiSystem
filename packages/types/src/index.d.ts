export type RoleName = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'REGIONAL_MANAGER' | 'STORE_MANAGER' | 'SHIFT_SUPERVISOR' | 'CASHIER' | 'ATTENDANT';
export type SubjectType = 'PLATFORM' | 'TENANT';
/** Payload do access token JWT. */
export interface JwtPayload {
    sub: string;
    email: string;
    role: RoleName;
    subjectType: SubjectType;
    tenantId?: string;
    tenantSchema?: string;
    storeId?: string;
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
