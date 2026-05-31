/** Minimal, dependency-free XML emission helpers for SAF-T. */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/** Render a leaf element <tag>value</tag>, escaping text. Omits when value is null/undefined. */
export function el(tag: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return `<${tag}>${escapeXml(String(value))}</${tag}>`;
}

/** Render a container element with already-rendered children. */
export function node(tag: string, children: string[]): string {
  const inner = children.filter((c) => c !== '').join('');
  return `<${tag}>${inner}</${tag}>`;
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
