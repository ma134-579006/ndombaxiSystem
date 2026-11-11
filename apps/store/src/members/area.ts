/** A segunda loja (só associados) abre em /<código>/associados ou com ?area=associados. */
export function isMembersArea(): boolean {
  if (typeof location === 'undefined') return false;
  const segs = location.pathname.split('/').filter(Boolean);
  return segs[1]?.toLowerCase() === 'associados' || new URLSearchParams(location.search).get('area') === 'associados';
}
