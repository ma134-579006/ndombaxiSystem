/**
 * Foto do perfil guardada no aparelho, por e-mail: o ecrã de login (conta
 * lembrada) e o ecrã de bloqueio mostram a foto mesmo antes de haver sessão ou
 * rede. Fotos enormes (data-URI) não se guardam, para não esgotar o espaço.
 */
const PREFIX = 'ndx:photo:';
const MAX = 400_000;

export function cachedPhoto(email: string | null | undefined): string | null {
  const k = (email ?? '').trim().toLowerCase();
  if (!k) return null;
  try { return localStorage.getItem(PREFIX + k); } catch { return null; }
}

export function rememberPhoto(email: string | null | undefined, photo: string | null): void {
  const k = (email ?? '').trim().toLowerCase();
  if (!k) return;
  try {
    if (photo && photo.length <= MAX) localStorage.setItem(PREFIX + k, photo);
    else localStorage.removeItem(PREFIX + k);
  } catch { /* sem espaço / sem armazenamento */ }
}
