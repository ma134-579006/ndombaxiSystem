/**
 * Tradução do ecrã a partir do dicionário PT→idioma.
 *
 * Os textos estão escritos em português no código. Em vez de reescrever cada
 * componente, observa-se o DOM (MutationObserver) e cada texto visível que
 * exista no dicionário é trocado pela tradução; o original fica guardado para
 * repor quando se volta ao português. Só se traduz o que corresponde EXATAMENTE
 * a uma entrada do dicionário (nomes de produtos, clientes e outros dados
 * escritos pelo utilizador não estão lá e ficam como estão).
 *
 * Fora da tradução: campos de escrita, código, e qualquer elemento marcado com
 * `translate="no"`, `.notranslate` ou `data-no-i18n`.
 */

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-label'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT', 'SVG']);

let dict: Map<string, string> | null = null;
let observer: MutationObserver | null = null;

/** Texto original (PT) e o último valor escrito por nós, por nó. */
const origText = new WeakMap<Text, string>();
const lastText = new WeakMap<Text, string>();
const origAttr = new WeakMap<Element, Map<string, string>>();
const lastAttr = new WeakMap<Element, Map<string, string>>();
/** Nós que já traduzimos (para repor o PT sem varrer a página toda). Sem
 *  WeakRef (navegadores antigos): os que saem do ecrã limpam-se de tempos a tempos. */
let touched = new Set<Text | Element>();
function remember(n: Text | Element): void {
  touched.add(n);
  if (touched.size > 20000) touched.forEach((x) => { if (!x.isConnected) touched.delete(x); });
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * MODELOS com partes variáveis: uma entrada do dicionário pode ter `{n}`
 * (número: 27, 1.254,50) e `{x}` (qualquer texto: um nome) — ex.:
 * "Faltam {n} dias para renovar" → "{n} days left to renew". Serve para as
 * frases montadas com números/nomes (incluindo as que vêm da API).
 */
type Pattern = { re: RegExp; names: string[]; out: string; key: string };
const patternCache = new WeakMap<Map<string, string>, Pattern[]>();
function patternsOf(d: Map<string, string>): Pattern[] {
  let ps = patternCache.get(d);
  if (ps) return ps;
  ps = [];
  d.forEach((out, k) => {
    if (!k.includes('{')) return;
    const names: string[] = [];
    const src = k.split(/(\{[nx]\d?\})/).map((part) => {
      const m = part.match(/^\{([nx]\d?)\}$/);
      if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(m[1]);
      return m[1].startsWith('n') ? '(-?\\d[\\d.,\\s]*?)' : '(.+?)';
    }).join('');
    // Maior pedaço fixo: filtro barato antes da expressão regular.
    const key = k.split(/\{[nx]\d?\}/).reduce((a, b) => (b.length > a.length ? b : a), '');
    if (names.length) ps!.push({ re: new RegExp(`^${src}$`), names, out, key });
  });
  // Os mais específicos (mais texto fixo) primeiro.
  ps.sort((a, b) => b.re.source.length - a.re.source.length);
  patternCache.set(d, ps);
  return ps;
}

/** Traduz um texto com o dicionário: entrada exata ou modelo com `{n}`/`{x}`. */
export function translateText(d: Map<string, string>, k: string): string | null {
  const v = d.get(k);
  if (v !== undefined) return v;
  if (!/\d|:/.test(k) && k.length < 3) return null;
  for (const p of patternsOf(d)) {
    if (p.key && !k.includes(p.key)) continue;
    const m = k.match(p.re);
    if (!m) continue;
    // {x} só apanha DADOS (número, nome próprio, código…): "Fatura {x}" nunca
    // traduz "Fatura simplificada" como se "simplificada" fosse um valor.
    if (p.names.some((n, i) => n.startsWith('x') && !/[\dA-ZÀ-Ý@#\/%€$+]/.test(m[i + 1] ?? ''))) continue;
    let out = p.out;
    p.names.forEach((n, i) => { out = out.split(`{${n}}`).join(m[i + 1]); });
    return out;
  }
  return null;
}

function lookup(raw: string): string | null {
  if (!dict) return null;
  const k = norm(raw);
  if (!k || k.length > 400) return null;
  const v = translateText(dict, k);
  if (v !== null) return v;
  // Variantes comuns: "Nome:" / "Nome *" / "A carregar..." → mesma entrada.
  const m = k.match(/^(.*?)(\s*[:*]|…|\.\.\.)$/);
  if (m && m[1]) {
    const base = dict.get(m[1].trim());
    if (base !== undefined) return base + m[2];
  }
  return null;
}

function skipped(el: Element | null): boolean {
  for (let p = el; p; p = p.parentElement) {
    if (SKIP_TAGS.has(p.tagName.toUpperCase())) return true;
    if (p.getAttribute('translate') === 'no' || p.classList.contains('notranslate') || p.hasAttribute('data-no-i18n')) return true;
    if ((p as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function doText(n: Text): void {
  const cur = n.data;
  if (!cur || !/[A-Za-zÀ-ÿ]/.test(cur)) return;
  const last = lastText.get(n);
  // Valor novo vindo da app (ou ainda nunca visto): passa a ser o original.
  let orig = origText.get(n);
  if (last === undefined || cur !== last) { orig = cur; origText.set(n, cur); }
  if (orig === undefined) return;
  if (!dict) { // português: repõe
    if (last !== undefined && cur === last) n.data = orig;
    lastText.delete(n);
    return;
  }
  if (skipped(n.parentElement)) return;
  const tr = lookup(orig);
  if (tr === null) { lastText.delete(n); return; }
  const lead = orig.match(/^\s*/)?.[0] ?? '';
  const trail = orig.match(/\s*$/)?.[0] ?? '';
  const next = lead + tr + trail;
  if (next !== cur) n.data = next;
  lastText.set(n, next);
  remember(n);
}

function doAttr(el: Element, name: string): void {
  const cur = el.getAttribute(name);
  if (cur === null || !/[A-Za-zÀ-ÿ]/.test(cur)) return;
  let o = origAttr.get(el); if (!o) { o = new Map(); origAttr.set(el, o); }
  let l = lastAttr.get(el); if (!l) { l = new Map(); lastAttr.set(el, l); }
  const last = l.get(name);
  if (last === undefined || cur !== last) o.set(name, cur);
  const orig = o.get(name)!;
  if (!dict) {
    if (last !== undefined && cur === last) el.setAttribute(name, orig);
    l.delete(name);
    return;
  }
  if (skipped(el)) return;
  const tr = lookup(orig);
  if (tr === null) { l.delete(name); return; }
  if (tr !== cur) el.setAttribute(name, tr);
  l.set(name, tr);
  remember(el);
}

function doElementAttrs(el: Element): void {
  for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
  // Botões <input type="button|submit"> mostram o "value".
  if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit') && el.value) doAttr(el, 'value');
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as Element;
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;
    doElementAttrs(el);
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has((n as Element).tagName.toUpperCase()))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let n = w.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doElementAttrs(n as Element);
    n = w.nextNode();
  }
}

function onMutations(list: MutationRecord[]): void {
  for (const m of list) {
    if (m.type === 'characterData') doText(m.target as Text);
    else if (m.type === 'attributes' && m.attributeName) doAttr(m.target as Element, m.attributeName);
    else m.addedNodes.forEach((n) => walk(n));
  }
}

/** Liga a observação do ecrã (idempotente). */
export function startDom(): void {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: [...ATTRS, 'value'],
  });
}

/** Aplica um dicionário a todo o ecrã (troca de idioma). */
export function applyDom(d: Map<string, string>): void {
  dict = d;
  walk(document.documentElement);
}

/** Volta ao português: repõe os originais e desliga a observação. */
export function stopDom(): void {
  dict = null;
  if (observer) { observer.disconnect(); observer = null; }
  const prev = touched; touched = new Set();
  prev.forEach((n) => {
    if (!n.isConnected) return;
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doElementAttrs(n as Element);
  });
}
