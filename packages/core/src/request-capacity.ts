import { capacitySetting } from './capacity';

/** Polling must not spend submission or cancellation capacity. This is HTTP
 * abuse protection per credential; model quotas and run budgets are separate. */
export function requestCapacity(method: string, operation: string) {
  const group = ['cancelRun', 'cancelCustomerAgentRun', 'submitRunInput'].includes(operation)
    ? 'control'
    : ['GET', 'HEAD'].includes(method)
      ? 'read'
      : 'write';
  const defaults = { read: 6000, write: 1200, control: 600 };
  const fallback = capacitySetting('API_RATE_LIMIT_PER_MINUTE', defaults[group], 1_000_000);
  return {
    group,
    limit: capacitySetting(`API_${group.toUpperCase()}_RATE_LIMIT_PER_MINUTE`, fallback, 1_000_000),
  };
}
