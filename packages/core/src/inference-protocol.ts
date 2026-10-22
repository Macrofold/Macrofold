import { decisionProtocol } from '../../providers/src/decision-protocols';
import { deploymentProtocol } from '../../providers/src/deployment-chat';
import type { InferenceConfig } from './runs';

/** Both bindings use the existing invocation and completion owner. Only native
 * wire adaptation differs; deployment selection never adds another executor. */
export function inferenceProtocol(
  configuration: Pick<InferenceConfig, 'rate_card' | 'model' | 'deployment_target' | 'limits'>,
  deploymentHeaders?: Record<string, string>,
) {
  return configuration.deployment_target
    ? deploymentProtocol(
        configuration.deployment_target,
        deploymentHeaders,
        configuration.limits.timeout_seconds,
      )
    : decisionProtocol(configuration.rate_card.provider, configuration.model);
}
