import { PublicWebcamsService, parseWindy } from './public-webcams.service';

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

describe('PublicWebcamsService', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const make = (secret: string | null, enabled = true) =>
    new PublicWebcamsService({
      getActive: jest.fn().mockResolvedValue(enabled ? { secret } : null),
    } as never);

  it('sem chave configurada não chama a Windy', async () => {
    const f = jest.fn(); global.fetch = f as never;
    expect(await make(null).nearby(-8.8, 13.2)).toEqual({ configured: false, radiusKm: 25, items: [] });
    expect(await make('k', false).nearby(-8.8, 13.2)).toMatchObject({ configured: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('pede as câmaras perto do ponto com a chave, ordena por distância e usa cache', async () => {
    const f = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => windyBody });
    global.fetch = f as never;
    const svc = make('chave-teste');
    const r = await svc.nearby(-12.5, 13.4, 999);
    expect(r.configured).toBe(true);
    expect(r.radiusKm).toBe(250);
    expect(r.items.map((w) => w.title)).toEqual(['Longe', 'Luanda — Marginal']);
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('nearby=-12.50000,13.40000,250');
    expect(url).toContain('include=images,location,player,urls');
    expect(init.headers['x-windy-api-key']).toBe('chave-teste');
    await svc.nearby(-12.5, 13.4, 999);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('chave inválida e falha de rede devolvem mensagem sem rebentar', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;
    expect((await make('x').nearby(1, 1)).error).toMatch(/inválida/);
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as never;
    expect((await make('x').nearby(1, 1)).error).toMatch(/indisponível/);
  });
});

describe('PublicWebcamsService.nearest (raio automático)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('alarga o raio até encontrar câmaras e marca expanded', async () => {
    const radii: number[] = [];
    global.fetch = jest.fn(async (url: string) => {
      const r = Number(/nearby=[^,]+,[^,]+,(\d+)/.exec(url)![1]);
      radii.push(r);
      const body = r >= 100 ? windyBody : { webcams: [] };
      return { ok: true, status: 200, json: async () => body };
    }) as never;
    const svc = new PublicWebcamsService({ getActive: jest.fn().mockResolvedValue({ secret: 'k' }) } as never);
    const out = await svc.nearest(-12.5, 13.4, 10);
    expect(radii).toEqual([10, 25, 50, 100]);
    expect(out).toMatchObject({ radiusKm: 100, expanded: true });
    expect(out.items.length).toBe(2);
  });

  it('pára logo se não estiver configurado ou houver erro', async () => {
    const f = jest.fn(); global.fetch = f as never;
    const off = new PublicWebcamsService({ getActive: jest.fn().mockResolvedValue(null) } as never);
    expect(await off.nearest(1, 1)).toMatchObject({ configured: false });
    expect(f).not.toHaveBeenCalled();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as never;
    const svc = new PublicWebcamsService({ getActive: jest.fn().mockResolvedValue({ secret: 'k' }) } as never);
    const out = await svc.nearest(1, 1);
    expect(out.error).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
