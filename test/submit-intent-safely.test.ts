import { OneClickClient } from '../src/client/one-click-client';
import { ApiError } from '../src/client/http';
import { submitIntentSafely } from '../src/flows/submit-intent-safely';
import { ExecutionStatus, SubmitIntentRequest } from '../src/types/one-click';

const request: SubmitIntentRequest = {
  type: 'swap_transfer',
  signedData: { standard: 'nep413', payload: {}, signature: 'sig' },
};

function statusResponse(status: string, intentHashes: string[] = []): ExecutionStatus {
  return {
    correlationId: 'c1',
    quoteResponse: {} as ExecutionStatus['quoteResponse'],
    status: status as ExecutionStatus['status'],
    updatedAt: new Date().toISOString(),
    swapDetails: { intentHashes, nearTxHashes: [] },
  };
}

describe('submitIntentSafely', () => {
  it('returns on first success without touching status', async () => {
    const client = new OneClickClient();
    const submit = jest.spyOn(client, 'submitIntent').mockResolvedValue({ intentHash: 'h1', correlationId: 'c1' });
    const getStatus = jest.spyOn(client, 'getStatus');

    const result = await submitIntentSafely(client, request, 'addr1');

    expect(result).toEqual({ intentHash: 'h1', correlationId: 'c1', recovered: false });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('rethrows a 4xx immediately: definitive rejection, no recovery attempt', async () => {
    const client = new OneClickClient();
    jest.spyOn(client, 'submitIntent').mockRejectedValue(new ApiError('u', 400, { message: 'bad signature' }));
    const getStatus = jest.spyOn(client, 'getStatus');

    await expect(submitIntentSafely(client, request, 'addr1')).rejects.toMatchObject({ status: 400 });
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('recovers when the first submission actually landed', async () => {
    const client = new OneClickClient();
    const submit = jest.spyOn(client, 'submitIntent').mockRejectedValue(new Error('socket hang up'));
    jest.spyOn(client, 'getStatus').mockResolvedValue(statusResponse('PROCESSING', ['h-existing']));

    const result = await submitIntentSafely(client, request, 'addr1');

    expect(result).toEqual({ intentHash: 'h-existing', correlationId: 'c1', recovered: true });
    expect(submit).toHaveBeenCalledTimes(1); // never resubmitted
  });

  it('resubmits when status proves the intent never arrived', async () => {
    const client = new OneClickClient();
    const submit = jest
      .spyOn(client, 'submitIntent')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ intentHash: 'h2', correlationId: 'c2' });
    jest.spyOn(client, 'getStatus').mockResolvedValue(statusResponse('PENDING_DEPOSIT'));

    const result = await submitIntentSafely(client, request, 'addr1', { retryDelayMs: 1 });

    expect(result).toEqual({ intentHash: 'h2', correlationId: 'c2', recovered: false });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts with the last error', async () => {
    const client = new OneClickClient();
    jest.spyOn(client, 'submitIntent').mockRejectedValue(new Error('timeout'));
    jest.spyOn(client, 'getStatus').mockResolvedValue(statusResponse('PENDING_DEPOSIT'));

    await expect(submitIntentSafely(client, request, 'addr1', { maxAttempts: 2, retryDelayMs: 1 })).rejects.toThrow(
      'timeout',
    );
  });
});
