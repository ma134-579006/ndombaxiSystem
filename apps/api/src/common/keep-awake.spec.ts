import { startKeepAwake, KEEP_AWAKE_INTERVAL_MS } from './keep-awake';

describe('startKeepAwake', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('não liga sem URL pública (posto local / desenvolvimento)', () => {
    const fetchFn = jest.fn();
    expect(startKeepAwake(undefined, { fetchFn })).toBeNull();
    expect(startKeepAwake('  ', { fetchFn })).toBeNull();
    jest.advanceTimersByTime(KEEP_AWAKE_INTERVAL_MS * 3);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('chama /health de 9 em 9 minutos (abaixo dos 15 do Render)', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const stop = startKeepAwake('https://api.exemplo.onrender.com/', { fetchFn });
    expect(stop).not.toBeNull();
    expect(KEEP_AWAKE_INTERVAL_MS).toBeLessThan(15 * 60 * 1000);
    jest.advanceTimersByTime(KEEP_AWAKE_INTERVAL_MS);
    jest.advanceTimersByTime(KEEP_AWAKE_INTERVAL_MS);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.exemplo.onrender.com/health');
    stop!();
    jest.advanceTimersByTime(KEEP_AWAKE_INTERVAL_MS * 2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('um pedido que falha não derruba nada e regista o motivo', async () => {
    const log = jest.fn();
    const fetchFn = jest.fn().mockRejectedValue(new Error('timeout'));
    const stop = startKeepAwake('https://x.onrender.com', { fetchFn, log });
    jest.advanceTimersByTime(KEEP_AWAKE_INTERVAL_MS);
    await Promise.resolve(); await Promise.resolve();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('timeout'));
    stop!();
  });
});
