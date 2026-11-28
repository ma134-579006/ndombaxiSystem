import { ReleaseSyncService, RELEASE_SOURCES, compareVersions, versionFromNotes } from './release-sync.service';

type Row = { id: string; platform: string; version: string; published: boolean; releasedAt: Date; fileUrl: string; mandatory: boolean };

function fakePrisma(rows: Row[]) {
  const appRelease = {
    findFirst: jest.fn(async ({ where }: { where: { platform: string; published: boolean } }) =>
      rows.filter((r) => r.platform === where.platform && r.published === where.published)
        .sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime())[0] ?? null),
    updateMany: jest.fn(async ({ where, data }: { where: { platform: string; published: boolean }; data: { published: boolean } }) => {
      rows.filter((r) => r.platform === where.platform && r.published === where.published).forEach((r) => { r.published = data.published; });
    }),
    create: jest.fn(async ({ data }: { data: Row }) => { rows.push({ ...data, id: String(rows.length + 1) }); }),
  };
  return { appRelease, $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ appRelease }) };
}

const release = (tag: string, version: string | null, asset: string) => ({
  ok: true, status: 200, headers: { get: (h: string) => (h === 'etag' ? `"${tag}-${version}"` : null) },
  json: async () => ({
    body: version ? `App. Commit abc1234, build #40. Versão: ${version}` : 'Notas antigas sem versão',
    published_at: '2026-10-06T10:00:00Z',
    assets: [{ name: asset, browser_download_url: `https://github.com/x/y/releases/download/${tag}/${asset}`, size: 123 }],
  }),
});

describe('versões', () => {
  it('lê a versão das notas e compara numericamente', () => {
    expect(versionFromNotes('Commit abc. Versão: 1.5.612.')).toBe('1.5.612');
    expect(versionFromNotes('versao: v2.0.1')).toBe('2.0.1');
    expect(versionFromNotes('sem nada')).toBeNull();
    expect(compareVersions('1.5.612', '1.5.1')).toBe(1);
    expect(compareVersions('1.5.10', '1.5.9')).toBe(1);
    expect(compareVersions('1.5.1', '1.5.1')).toBe(0);
  });
});

describe('ReleaseSyncService', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('publica a versão nova de cada app e despublica a anterior (bloqueia as antigas)', async () => {
    const rows: Row[] = [
      { id: 'a', platform: 'windows', version: '1.5.1', published: true, releasedAt: new Date('2026-10-01'), fileUrl: 'x', mandatory: false },
    ];
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/windows-latest')) return release('windows-latest', '1.5.640', 'LPSVendas-Setup-x64.exe');
      if (url.endsWith('/windows7-latest')) {
        const r = release('windows7-latest', '1.5.640', 'LPSVendas-Setup-win7-x64.exe');
        const j = r.json;
        return { ...r, json: async () => { const b = await j(); b.assets.push({ name: 'LPSVendas-Setup-win7-ia32.exe', browser_download_url: 'https://github.com/x/y/releases/download/windows7-latest/LPSVendas-Setup-win7-ia32.exe', size: 1 }); return b; } };
      }
      if (url.endsWith('/android-latest')) return release('android-latest', '1.5.640', 'LPSVendas-Android.apk');
      if (url.endsWith('/android-kwanza-latest')) return release('android-kwanza-latest', '1.5.640', 'LPSKwanza-Android.apk');
      if (url.endsWith('/windows-kwanza-latest')) return release('windows-kwanza-latest', '1.5.640', 'LPSKwanza-Setup-x64.exe');
      return release('android-loja-latest', '1.5.640', 'LPSLoja-Android.apk');
    }) as never;
    const svc = new ReleaseSyncService(fakePrisma(rows) as never);
    const out = await svc.sync(true);
    expect(out.map((r) => [r.platform, r.action, r.version])).toEqual([
      ['windows', 'published', '1.5.640'], ['windows7', 'published', '1.5.640'], ['windows7-32', 'published', '1.5.640'], ['android', 'published', '1.5.640'], ['android-loja', 'published', '1.5.640'],
      ['android-kwanza', 'published', '1.5.640'], ['windows-kwanza', 'published', '1.5.640'],
    ]);
    const pub = rows.filter((r) => r.published);
    expect(pub.map((r) => `${r.platform}@${r.version}`).sort()).toEqual(['android-kwanza@1.5.640', 'android-loja@1.5.640', 'android@1.5.640', 'windows-kwanza@1.5.640', 'windows7-32@1.5.640', 'windows7@1.5.640', 'windows@1.5.640']);
    expect(rows.find((r) => r.id === 'a')!.published).toBe(false);
    expect(pub.every((r) => r.mandatory)).toBe(true);
    expect(pub.find((r) => r.platform === 'windows')!.fileUrl).toContain('/windows-latest/LPSVendas-Setup-x64.exe');
  });

  it('não duplica nem regride: mesma versão ou mais antiga fica como está', async () => {
    const rows: Row[] = [
      { id: 'a', platform: 'windows', version: '1.5.700', published: true, releasedAt: new Date(), fileUrl: 'x', mandatory: true },
    ];
    global.fetch = jest.fn(async () => release('windows-latest', '1.5.640', 'LPSVendas-Setup-x64.exe')) as never;
    const svc = new ReleaseSyncService(fakePrisma(rows) as never);
    const out = await svc.sync(true);
    expect(out[0]).toMatchObject({ platform: 'windows', action: 'unchanged' });
    expect(rows).toHaveLength(1);
  });

  it('ignora releases antigas sem "Versão:" e respostas 304/erro', async () => {
    const rows: Row[] = [];
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/windows-latest')) return release('windows-latest', null, 'LPSVendas-Setup-x64.exe');
      if (url.endsWith('/android-latest')) return { ok: false, status: 304, headers: { get: () => null } };
      return { ok: false, status: 403, headers: { get: () => null } };
    }) as never;
    const out = await new ReleaseSyncService(fakePrisma(rows) as never).sync(true);
    expect(out.map((r) => r.action)).toEqual(['skipped', 'skipped', 'skipped', 'unchanged', 'skipped', 'skipped', 'skipped']);
    expect(rows).toHaveLength(0);
  });

  it('pedidos seguidos (CI) não martelam o GitHub', async () => {
    const f = jest.fn(async () => release('windows-latest', '1.5.640', 'LPSVendas-Setup-x64.exe'));
    global.fetch = f as never;
    const svc = new ReleaseSyncService(fakePrisma([]) as never);
    await svc.sync();
    await svc.sync();
    expect(f).toHaveBeenCalledTimes(RELEASE_SOURCES.length); // uma por app
  });
});

describe('ReleaseSyncService.syncIfStale', () => {
  const realFetch = global.fetch;
  const env = process.env.NODE_ENV;
  afterEach(() => { global.fetch = realFetch; process.env.NODE_ENV = env; });

  it('uma app a perguntar a versão dispara a sincronização só se a última for antiga', async () => {
    process.env.NODE_ENV = 'production';
    const f = jest.fn(async () => release('windows-latest', '1.5.900', 'LPSVendas-Setup-x64.exe'));
    global.fetch = f as never;
    const svc = new ReleaseSyncService(fakePrisma([]) as never);
    // Espera DETERMINÍSTICA (até 2 s) pedidos paralelos (um por app) — 10 ms fixos
    // falhavam com a máquina carregada (teste instável na bateria completa).
    const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); };
    svc.syncIfStale();
    await until(() => f.mock.calls.length >= RELEASE_SOURCES.length);
    expect(f).toHaveBeenCalledTimes(RELEASE_SOURCES.length); // uma por app
    svc.syncIfStale();
    await new Promise((r) => setTimeout(r, 50));
    expect(f).toHaveBeenCalledTimes(RELEASE_SOURCES.length); // a 2.ª chamada não volta a sincronizar
  });
});

describe('ReleaseSyncService — API do GitHub em 403 (auditoria 2026-11-09)', () => {
  const ATOM = `<?xml version="1.0"?><feed>
  <entry><id>tag:github.com,2008:Repository/1/windows-latest</id><updated>2026-11-09T12:00:36Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/ma134-579006/ndombaxiSystem/releases/tag/windows-latest"/>
    <content type="html">&lt;p&gt;Instalador. Versão: 1.5.966&lt;/p&gt;</content></entry>
  <entry><id>tag:github.com,2008:Repository/1/android-latest</id><updated>2026-11-09T11:21:20Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/ma134-579006/ndombaxiSystem/releases/tag/android-latest"/>
    <content type="html">&lt;p&gt;APK. Versão: 1.5.964&lt;/p&gt;</content></entry>
</feed>`;

  it('lê a versão pelo feed público e publica com o link fixo do ficheiro', async () => {
    const rows: Row[] = [];
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/releases.atom')) return { ok: true, status: 200, text: async () => ATOM, headers: { get: (): string | null => null } };
      return { ok: false, status: 403, headers: { get: (): string | null => null } };
    }) as never;
    const out = await new ReleaseSyncService(fakePrisma(rows) as never).sync(true);
    expect(out.map((r) => r.action)).toEqual(['published', 'skipped', 'skipped', 'published', 'skipped', 'skipped', 'skipped']); // o Windows 7, a Loja e o Kwanza não estão no feed de teste
    const win = rows.find((r) => r.platform === 'windows')!;
    expect(win.version).toBe('1.5.966');
    expect(win.mandatory).toBe(true);
    expect(win.fileUrl).toBe('https://github.com/ma134-579006/ndombaxiSystem/releases/download/windows-latest/LPSVendas-Setup-x64.exe');
  });
});
