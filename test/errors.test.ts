import { ApiError } from '../src/client/http';
import { classifyError, explainError, isAmbiguous, isRetryable } from '../src/utils/errors';

function apiError(status: number): ApiError {
  return new ApiError('https://1click.chaindefuser.com/v0/quote', status, { message: 'boom' });
}

describe('classifyError', () => {
  it('treats 4xx as terminal: neither retryable nor ambiguous', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const advice = classifyError(apiError(status));
      expect(advice.retryable).toBe(false);
      expect(advice.ambiguous).toBe(false);
    }
  });

  it('names the specific 4xx kinds so callers can react differently', () => {
    expect(classifyError(apiError(401)).kind).toBe('AUTH');
    expect(classifyError(apiError(403)).kind).toBe('FORBIDDEN');
    expect(classifyError(apiError(404)).kind).toBe('NOT_FOUND');
    expect(classifyError(apiError(400)).kind).toBe('INVALID_REQUEST');
  });

  it('treats 429 as retryable but unambiguous: the request was refused, not applied', () => {
    const advice = classifyError(apiError(429));
    expect(advice.kind).toBe('RATE_LIMIT');
    expect(advice.retryable).toBe(true);
    expect(advice.ambiguous).toBe(false);
  });

  // The distinction that prevents double-submits.
  it('treats 5xx as both retryable and ambiguous', () => {
    const advice = classifyError(apiError(503));
    expect(advice.kind).toBe('SERVER');
    expect(advice.retryable).toBe(true);
    expect(advice.ambiguous).toBe(true);
  });

  it('treats network failures and timeouts as ambiguous', () => {
    const timeout = new Error('The operation timed out');
    timeout.name = 'TimeoutError';
    expect(classifyError(timeout).kind).toBe('NETWORK');
    expect(isAmbiguous(timeout)).toBe(true);
    expect(isRetryable(timeout)).toBe(true);
    expect(isAmbiguous(new Error('socket hang up'))).toBe(true);
  });

  it('treats an unrecognized throw as ambiguous rather than assuming success', () => {
    const advice = classifyError('something odd');
    expect(advice.kind).toBe('UNKNOWN');
    expect(advice.ambiguous).toBe(true);
    expect(advice.retryable).toBe(false);
  });
});

describe('explainError', () => {
  it('includes the kind, status, and a next step', () => {
    const text = explainError(apiError(401));
    expect(text).toContain('AUTH');
    expect(text).toContain('401');
    expect(text).toContain('ONE_CLICK_API_KEY');
  });
});
