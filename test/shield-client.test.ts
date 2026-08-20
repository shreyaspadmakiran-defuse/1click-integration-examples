import { ShieldClient } from '../src/client/shield-client';

const BASE = 'https://shield.example.test';

function mockFetchOnce(status: number, body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('ShieldClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('GET /incident sends the partner token', async () => {
    const mock = mockFetchOnce(200, { status: 'operational' });
    const client = new ShieldClient({ baseUrl: BASE, token: 'shield-token' });
    const result = await client.getIncidents();

    expect(result.status).toBe('operational');
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/incident`);
    expect(init.headers.authorization).toBe('Bearer shield-token');
  });

  it('POST /incident submits a scoped incident', async () => {
    const mock = mockFetchOnce(200, { incident: { id: 'i1', status: 'active' } });
    const client = new ShieldClient({ baseUrl: BASE, token: 'shield-token' });
    const result = await client.submitIncident({
      scopeType: 'chain',
      scopeValue: 'eth',
      direction: 'withdraw',
      description: 'ETH withdrawals are temporarily unavailable',
    });

    expect(result.incident.id).toBe('i1');
    const [, init] = mock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ scopeType: 'chain', scopeValue: 'eth', direction: 'withdraw' });
  });
});
