import { OneClickClient } from '../src/client/one-click-client';
import { ApiError } from '../src/client/http';

const BASE = 'https://1click.example.test';

function mockFetchOnce(status: number, body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('OneClickClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('GET /v0/tokens hits the right URL with no auth by default', async () => {
    const mock = mockFetchOnce(200, [{ assetId: 'nep141:wrap.near' }]);
    const client = new OneClickClient({ baseUrl: BASE });
    const tokens = await client.getTokens();

    expect(tokens[0].assetId).toBe('nep141:wrap.near');
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/v0/tokens`);
    expect(init.method).toBe('GET');
    expect(init.headers.authorization).toBeUndefined();
  });

  it('POST /v0/quote sends JWT and body', async () => {
    const mock = mockFetchOnce(200, { correlationId: 'c1', quote: {}, quoteRequest: {} });
    const client = new OneClickClient({ baseUrl: BASE, jwt: 'my-jwt' });
    await client.getQuote({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: 'nep141:wrap.near',
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: 'nep141:usdt.tether-token.near',
      amount: '1',
      recipient: 'user.near',
      recipientType: 'DESTINATION_CHAIN',
      refundTo: 'user.near',
      refundType: 'ORIGIN_CHAIN',
      deadline: '2026-01-01T00:00:00.000Z',
    });

    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/v0/quote`);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer my-jwt');
    expect(JSON.parse(init.body).swapType).toBe('EXACT_INPUT');
  });

  it('GET /v0/status passes depositAddress and optional memo as query params', async () => {
    const mock = mockFetchOnce(200, { status: 'PENDING_DEPOSIT' });
    const client = new OneClickClient({ baseUrl: BASE });
    await client.getStatus('addr1', 'memo1');

    const [url] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/v0/status?depositAddress=addr1&depositMemo=memo1`);
  });

  it('omits undefined query params', async () => {
    const mock = mockFetchOnce(200, { status: 'PENDING_DEPOSIT' });
    const client = new OneClickClient({ baseUrl: BASE });
    await client.getStatus('addr1');

    const [url] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/v0/status?depositAddress=addr1`);
  });

  it('POST /v0/generate-intent and /v0/submit-intent send X-API-Key', async () => {
    const mock = mockFetchOnce(200, { intent: {}, correlationId: 'c2' });
    const client = new OneClickClient({ baseUrl: BASE, apiKey: 'partner-key' });
    await client.generateIntent({
      type: 'swap_transfer',
      standard: 'nep413',
      signerId: 'user.near',
      depositAddress: 'addr1',
    });

    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/v0/generate-intent`);
    expect(init.headers['x-api-key']).toBe('partner-key');
  });

  it('maps non-2xx responses to ApiError with status and body', async () => {
    mockFetchOnce(404, { message: 'Deposit address not found' });
    const client = new OneClickClient({ baseUrl: BASE, retries: 0 });

    await expect(client.getStatus('missing')).rejects.toThrow(ApiError);
    await expect(client.getStatus('missing')).rejects.toMatchObject({ status: 404 });
  });

  it('retries GET on 500 but not POST submit-intent', async () => {
    const failThenSucceed = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('{}') })
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('[]') });
    global.fetch = failThenSucceed as unknown as typeof fetch;

    const client = new OneClickClient({ baseUrl: BASE, retries: 1 });
    await expect(client.getTokens()).resolves.toEqual([]);
    expect(failThenSucceed).toHaveBeenCalledTimes(2);

    const alwaysFail = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('{}') });
    global.fetch = alwaysFail as unknown as typeof fetch;
    await expect(
      client.submitIntent({ type: 'swap_transfer', signedData: { standard: 'nep413', payload: {}, signature: 's' } }),
    ).rejects.toThrow(ApiError);
    expect(alwaysFail).toHaveBeenCalledTimes(1);
  });
});
