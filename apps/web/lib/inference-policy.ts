import { CrusoeInferenceError } from '@thermaldesk/analysis';

export function guardedInferenceFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, options) => {
    if (process.env.CRUSOE_LIVE_REQUESTS_ENABLED !== 'true') {
      throw new CrusoeInferenceError('not_configured', 'Billable provider calls are disabled. Use fixtures until explicitly authorized.');
    }
    return fetchImpl(input, options);
  };
}
