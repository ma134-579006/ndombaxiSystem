/**
 * WORKSPACE — memória de trabalho por UTILIZADOR.
 *
 * Se a sessão cair (logout automático por inatividade, fecho do browser),
 * ao voltar a entrar o utilizador continua EXATAMENTE onde estava:
 *   • a mesma página (secção) do painel;
 *   • o que estava a escrever (rascunhos de inputs/textareas).
 *
 * SEGURANÇA:
 *   • Tudo é guardado POR UTILIZADOR (chave inclui o id do utilizador) — outro
 *     utilizador no mesmo computador NUNCA vê os rascunhos de outrem.
 *   • Campos sensíveis NUNCA são guardados: passwords, PINs, códigos 2FA,
 *     IBANs e números de cartão são excluídos por tipo e por nome.
 *   • Validade de 24h — depois disso os rascunhos expiram e são apagados.
 *   • Limite de tamanho (64 KB) para não encher o armazenamento.
 */

const PREFIX = 'ndombaxi.ws.';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const MAX_BYTES = 64 * 1024;

/** Campos que NUNCA podem ser guardados (segurança). */
const SENSITIVE = /senha|password|pin\b|2fa|otp|cart[aã]o|cvv|iban/i;

interface DraftStore {
  savedAt: number;
  section: string;
  /** assinatura do campo → valor */
  fields: Record<string, string>;
}

function key(userId: string): string { return `${PREFIX}${userId}`; }

function read(userId: string): DraftStore | null {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftStore;
    if (!d.savedAt || Date.now() - d.savedAt > TTL_MS) { localStorage.removeItem(key(userId)); return null; }
    return d;
  } catch { return null; }
}

function write(userId: string, d: DraftStore): void {
  try {
    const raw = JSON.stringify(d);
    if (raw.length > MAX_BYTES) return; // nunca rebenta o armazenamento
    localStorage.setItem(key(userId), raw);
  } catch { /* armazenamento cheio/indisponível — ignora */ }
}

/** Assinatura estável de um campo (id > name > placeholder+posição). */
function signatureOf(el: HTMLInputElement | HTMLTextAreaElement): string | null {
  if (el instanceof HTMLInputElement) {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'password' || t === 'hidden' || t === 'file' || t === 'checkbox' || t === 'radio') return null;
  }
  const label = el.id || el.name || el.placeholder || '';
  const aria = el.getAttribute('aria-label') || '';
  if (SENSITIVE.test(label) || SENSITIVE.test(aria)) return null;
  if (!label) return null; // sem identificação estável → não guarda
  return `${el.tagName}:${label}`;
}

/** A página (secção) onde o utilizador estava. */
export function saveSection(userId: string, section: string): void {
  const d = read(userId) ?? { savedAt: Date.now(), section, fields: {} };
  d.section = section; d.savedAt = Date.now();
  write(userId, d);
}
export function loadSection(userId: string): string | null {
  return read(userId)?.section ?? null;
}

/** Liga a captura de rascunhos (chamar uma vez por sessão autenticada).
 *  Devolve a função para desligar. */
export function startDraftCapture(userId: string, getSection: () => string): () => void {
  const onInput = (ev: Event) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
    const sig = signatureOf(el);
    if (!sig) return;
    const d = read(userId) ?? { savedAt: Date.now(), section: getSection(), fields: {} };
    const k = `${getSection()}|${sig}`;
    if (el.value) d.fields[k] = el.value;
    else delete d.fields[k];
    d.savedAt = Date.now();
    write(userId, d);
  };
  document.addEventListener('input', onInput, true);
  return () => document.removeEventListener('input', onInput, true);
}

/** Repõe os rascunhos da secção atual nos campos visíveis (após o render).
 *  Usa o setter nativo + evento para o React aceitar o valor. */
export function restoreDrafts(userId: string, section: string): void {
  const d = read(userId);
  if (!d) return;
  const entries = Object.entries(d.fields).filter(([k]) => k.startsWith(`${section}|`));
  if (entries.length === 0) return;
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
  for (const [k, value] of entries) {
    const sig = k.slice(section.length + 1);
    const el = inputs.find((i) => signatureOf(i) === sig);
    if (!el || el.value) continue; // não pisa o que o utilizador já escreveu
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

/** Limpa tudo (ex.: quando o utilizador termina/envia um formulário grande). */
export function clearWorkspace(userId: string): void {
  try { localStorage.removeItem(key(userId)); } catch { /* ignora */ }
}
