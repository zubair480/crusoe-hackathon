import { it, expect, vi, afterEach } from 'vitest';
import { guardedInferenceFetch } from './inference-policy';
afterEach(() => vi.unstubAllEnvs());
it('blocks provider requests before touching the network when spending is disabled', async () => {
  vi.stubEnv('CRUSOE_LIVE_REQUESTS_ENABLED', 'false');
  const network = vi.fn();
  await expect(guardedInferenceFetch(network)('https://api.inference.crusoecloud.com/v1/chat/completions')).rejects.toThrow('disabled');
  expect(network).not.toHaveBeenCalled();
});
it('defaults to no provider requests when the live-request setting is absent', async () => {
  vi.stubEnv('CRUSOE_LIVE_REQUESTS_ENABLED', undefined);
  const network = vi.fn();
  await expect(guardedInferenceFetch(network)('https://api.inference.crusoecloud.com/v1/chat/completions')).rejects.toThrow('disabled');
  expect(network).not.toHaveBeenCalled();
});
