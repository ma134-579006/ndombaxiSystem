import { PublicWebcamsService, parseOverpass, parseWindy } from './public-webcams.service';

const windyBody = {
  total: 3,
  webcams: [
    {
      webcamId: 1700000001, status: 'active', title: 'Luanda — Marginal', lastUpdatedOn: '2026-10-06T10:00:00.000Z',
      location: { city: 'Luanda', latitude: -8.81, longitude: 13.23 },
      images: { current: { icon: 'i.jpg', thumbnail: 't.jpg', preview: 'https://imgproxy.windy.com/p.jpg' } },
      player: { day: 'https://webcams.windy.com/webcams/public/embed/player/1700000001/day' },
      urls: { detail: 'https://www.windy.com/webcams/1700000001' },
    },
    { webcamId: 2, status: 'inactive', title: 'Desligada', location: { latitude: -8.8, longitude: 13.2 } },
    { webcamId: 3, title: 'Sem posição', location: {} },
    {
      webcamId: 1700000004, status: 'active', title: 'Longe',
      location: { city: 'Benguela', latitude: -12.58, longitude: 13.4 },
      player: { live: { embed: 'https://webcams.windy.com/live/4' } },
    },
  ],
};

describe('parseWindy', () => {
  it('converte webcams activas com posição e ignora o resto', () => {
    const out = parseWindy(windyBody);
    expect(out.map((w) => w.id)).toEqual(['1700000001', '1700000004']);
    expect(out[0]).toMatchObject({
      title: 'Luanda — Marginal', lat: -8.81, lng: 13.23, city: 'Luanda',
      image: 'https://imgproxy.windy.com/p.jpg',
      player: 'https://webcams.windy.com/webcams/public/embed/player/1700000001/day',
      pageUrl: 'https://www.windy.com/webcams/1700000001',
    });
    expect(out[1].player).toBe('https://webcams.windy.com/live/4');
    expect(out[1].pageUrl).toBe('https://www.windy.com/webcams/1700000004');
  });

  it('tolera respostas inesperadas', () => {
    expect(parseWindy(null)).toEqual([]);
    expect(parseWindy({ webcams: 'x' })).toEqual([]);
  });
});

const overpassBody = {
  elements: [
    { type: 'node', id: 11, lat: -8.91, lon: 13.19, tags: { name: 'Praça (webcam)', 'contact:webcam': 'https://cam.example.ao/live.jpg' } },
    { type: 'way', id: 12, center: { lat: -8.95, lon: 13.2 }, tags: { webcam: 'http://cam2.example.ao/' } },
    { type: 'node', id: 13, lat: -8.9, lon: 13.1, tags: { webcam: 'javascript:alert(1)' } },
    { type: 'node', id: 14, lat: -8.9, lon: 13.1, tags: { 'contact:webcam': 'https://cam.example.ao/live.jpg' } },
  ],
};
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('parseOverpass', () => {
  it('lê webcams públicas do OpenStreetMap; imagem direta só https; ignora links inválidos e repetidos', () => {
    const out = parseOverpass(overpassBody);
    expect(out.map((w) => w.id)).toEqual(['osm-node-11', 'osm-way-12']);
    expect(out[0]).toMatchObject({ title: 'Praça (webcam)', image: 'https://cam.example.ao/live.jpg', source: 'osm' });
    expect(out[1]).toMatchObject({ title: 'Câmara pública', image: null, pageUrl: 'http://cam2.example.ao/', lat: -8.95, lng: 13.2 });
    expect(parseOverpass({})).toEqual([]);
  });
});

describe('PublicWebcamsService', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const make = (secret: string | null, enabled = true) =>
    new PublicWebcamsService({
      getActive: jest.fn().mockResolvedValue(enabled ? { secret } : null),
    } as never);

  it('SEM chave: usa o OpenStreetMap automaticamente (não chama a Windy)', async () => {
    const f = jest.fn(async (url: string, _init?: unknown) => (/overpass/.test(url) ? ok(overpassBody) : ok(windyBody)));
    global.fetch = f as never;
    const r = await make(null).nearby(-8.9, 13.19);
    expect(r).toMatchObject({ configured: true, sources: ['osm'] });
    expect(r.items.map((w) => w.source)).toEqual(['osm', 'osm']);
    expect(f.mock.calls.every(([u]) => /overpass/.test(u as string))).toBe(true);
    const body = decodeURIComponent(String((f.mock.calls[0][1] as unknown as { body: string }).body));
    expect(body).toContain('around:25000,-8.90000,13.19000');
  });

  it('COM chave: junta Windy + OpenStreetMap, ordena por distância e usa cache', async () => {
    const f = jest.fn(async (url: string, _init?: unknown) => (/overpass/.test(url) ? ok(overpassBody) : ok(windyBody)));
    global.fetch = f as never;
    const svc = make('chave-teste');
    const r = await svc.nearby(-12.5, 13.4, 999);
    expect(r.radiusKm).toBe(250);
    expect(r.sources?.sort()).toEqual(['osm', 'windy']);
    expect(r.items[0].title).toBe('Longe'); // Benguela, a mais perto de -12.5
    const w = f.mock.calls.find(([u]) => !/overpass/.test(u as string))!;
    expect(w[0]).toContain('nearby=-12.50000,13.40000,250');
    expect((w[1] as unknown as { headers: Record<string, string> }).headers['x-windy-api-key']).toBe('chave-teste');
    await svc.nearby(-12.5, 13.4, 999);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('uma fonte em baixo não esconde a outra; erro só quando nenhuma responde', async () => {
    global.fetch = jest.fn(async (url: string) => (/overpass/.test(url) ? ok(overpassBody) : { ok: false, status: 401 })) as never;
    const r = await make('x').nearby(-8.9, 13.19);
    expect(r.error).toBeUndefined();
    expect(r.items.length).toBe(2);
    global.fetch = jest.fn(async (url: string) => (/overpass/.test(url) ? { ok: false, status: 504 } : { ok: false, status: 401 })) as never;
    expect((await make('x').nearby(1, 1)).error).toBeTruthy();
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as never;
    expect((await make(null).nearby(2, 2)).error).toMatch(/indisponível/);
  });
});

describe('PublicWebcamsService.nearest (raio automático)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('alarga o raio até encontrar câmaras e marca expanded', async () => {
    const radii: number[] = [];
    global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      const m = /around:(\d+)/.exec(decodeURIComponent(init?.body ?? ''));
      const r = m ? Number(m[1]) / 1000 : Number(/nearby=[^,]+,[^,]+,(\d+)/.exec(url)![1]);
      if (/overpass/.test(url)) { radii.push(r); return ok(r >= 100 ? overpassBody : { elements: [] }); }
      return ok({ webcams: [] });
    }) as never;
    const out = await make(null).nearest(-8.9, 13.19, 10);
    expect(radii).toEqual([10, 25, 50, 100]);
    expect(out).toMatchObject({ radiusKm: 100, expanded: true });
    expect(out.items.length).toBe(2);
  });

  it('pára logo quando o serviço falha', async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = f as never;
    const out = await make(null).nearest(1, 1);
    expect(out.error).toBeTruthy();
    expect(f).toHaveBeenCalledTimes(1);
  });

  const make = (secret: string | null) =>
    new PublicWebcamsService({ getActive: jest.fn().mockResolvedValue(secret ? { secret } : null) } as never);
});
