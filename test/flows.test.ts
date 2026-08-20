import { pollUntilSettled } from '../src/flows/poll-status';
import { preflight } from '../src/flows/preflight';
import { OneClickClient } from '../src/client/one-click-client';
import { ShieldClient } from '../src/client/shield-client';
import { ExecutionStatus, QuoteRequest } from '../src/types/one-click';

function statusResponse(status: string): ExecutionStatus {
  return {
    correlationId: 'c1',
    quoteResponse: {} as ExecutionStatus['quoteResponse'],
    status: status as ExecutionStatus['status'],
    updatedAt: new Date().toISOString(),
    swapDetails: { intentHashes: [], nearTxHashes: [] },
  };
}

const quoteRequest: QuoteRequest = {
  dry: true,
  swapType: 'EXACT_INPUT',
  slippageTolerance: 100,
  originAsset: 'nep141:wrap.near',
  depositType: 'ORIGIN_CHAIN',
  destinationAsset: 'nep141:eth.omft.near',
  amount: '1000000000000000000000000',
  recipient: '0xabc',
  recipientType: 'DESTINATION_CHAIN',
  refundTo: 'user.near',
  refundType: 'ORIGIN_CHAIN',
  // Must be in the future: preflight now validates the request before quoting.
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
};

describe('pollUntilSettled', () => {
  it('polls until a terminal status and reports transitions', async () => {
    const client = new OneClickClient();
    const getStatus = jest
      .spyOn(client, 'getStatus')
      .mockResolvedValueOnce(statusResponse('PENDING_DEPOSIT'))
      .mockResolvedValueOnce(statusResponse('PROCESSING'))
      .mockResolvedValueOnce(statusResponse('SUCCESS'));

    const transitions: string[] = [];
    const final = await pollUntilSettled(client, 'addr1', {
      intervalMs: 1,
      onUpdate: (s) => transitions.push(s.status),
    });

    expect(final.status).toBe('SUCCESS');
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(transitions).toEqual(['PENDING_DEPOSIT', 'PROCESSING', 'SUCCESS']);
  });

  it('times out on a swap that never settles', async () => {
    const client = new OneClickClient();
    jest.spyOn(client, 'getStatus').mockResolvedValue(statusResponse('PROCESSING'));

    await expect(pollUntilSettled(client, 'addr1', { intervalMs: 1, timeoutMs: 10 })).rejects.toThrow(/Timed out/);
  });
});

describe('preflight', () => {
  it('passes when shield is operational and the dry quote succeeds', async () => {
    const oneClick = new OneClickClient();
    jest.spyOn(oneClick, 'getQuote').mockResolvedValue({ correlationId: 'c1' } as never);
    const shield = new ShieldClient({ token: 't' });
    jest.spyOn(shield, 'getIncidents').mockResolvedValue({ status: 'operational' });

    const result = await preflight(oneClick, quoteRequest, { shield });
    expect(result.ok).toBe(true);
    expect(result.blockingIncidents).toHaveLength(0);
  });

  it('flags an incident on the origin chain', async () => {
    const oneClick = new OneClickClient();
    jest.spyOn(oneClick, 'getQuote').mockResolvedValue({ correlationId: 'c1' } as never);
    jest.spyOn(oneClick, 'getTokens').mockResolvedValue([
      { assetId: 'nep141:wrap.near', decimals: 24, blockchain: 'near', symbol: 'wNEAR', price: 1, priceUpdatedAt: '' },
      { assetId: 'nep141:eth.omft.near', decimals: 18, blockchain: 'eth', symbol: 'ETH', price: 1, priceUpdatedAt: '' },
    ]);
    const shield = new ShieldClient({ token: 't' });
    jest.spyOn(shield, 'getIncidents').mockResolvedValue({
      status: 'incidents',
      incidents: [{ scopeType: 'chain', scopeValue: 'eth', direction: 'withdraw', publicDescription: 'delayed' }],
    });

    const result = await preflight(oneClick, quoteRequest, { shield });
    expect(result.ok).toBe(false);
    expect(result.blockingIncidents).toHaveLength(1);
    expect(result.problems[0]).toContain('chain eth');
  });

  it('does not hard-fail when shield is unreachable', async () => {
    const oneClick = new OneClickClient();
    jest.spyOn(oneClick, 'getQuote').mockResolvedValue({ correlationId: 'c1' } as never);
    const shield = new ShieldClient({ token: 't' });
    jest.spyOn(shield, 'getIncidents').mockRejectedValue(new Error('network down'));

    const result = await preflight(oneClick, quoteRequest, { shield });
    expect(result.ok).toBe(true);
    expect(result.problems[0]).toContain('Shield check failed');
  });

  it('fails when the dry quote is rejected', async () => {
    const oneClick = new OneClickClient();
    jest.spyOn(oneClick, 'getQuote').mockRejectedValue(new Error('HTTP 400: amount too low'));

    const result = await preflight(oneClick, quoteRequest);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('Dry quote rejected');
  });

  it('rejects an illegal swap-type combination without spending a quote call', async () => {
    const oneClick = new OneClickClient();
    const getQuote = jest.spyOn(oneClick, 'getQuote');

    const result = await preflight(oneClick, { ...quoteRequest, swapType: 'ANY_INPUT' });

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('not supported for ANY_INPUT');
    expect(getQuote).not.toHaveBeenCalled();
  });

  it('surfaces warnings without blocking', async () => {
    const oneClick = new OneClickClient();
    jest.spyOn(oneClick, 'getQuote').mockResolvedValue({ correlationId: 'c1' } as never);

    const result = await preflight(oneClick, { ...quoteRequest, swapType: 'EXACT_OUTPUT' });

    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('denominated in destinationAsset');
  });
});
