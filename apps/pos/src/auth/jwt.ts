/** Descodifica o payload de um JWT (apenas leitura; a verificação é do servidor). */
export interface DecodedJwt {
  sub: string;
  email: string;
  name?: string;
  role: string;
  subjectType: 'PLATFORM' | 'TENANT';
  tenantId?: string;
  tenantSchema?: string;
  storeId?: string;
  twoFaVerified?: boolean;
  exp?: number;
  iat?: number;
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64); // garantido pelo DOM
  try {
    // Recupera UTF-8 (caracteres acentuados).
    return decodeURIComponent(
      binary
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
  } catch {
    return binary;
  }
}

export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as DecodedJwt;
  } catch {
    return null;
  }
}

/** True se o token estiver expirado (margem de 30s). */
export function isExpired(token: string): boolean {
  const decoded = decodeJwt(token);
  if (!decoded?.exp) return false;
  return decoded.exp * 1000 < Date.now() + 30_000;
}
