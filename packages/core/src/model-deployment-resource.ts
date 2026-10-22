import type { DeploymentResourceRow, ServingObservation } from './model-deployment-types';

/** Account-key rotation and lost-create recovery share the same immutable
 * ownership evidence. A provider ID or attempt tag alone is insufficient. */
export function matchesDeploymentResource(resource: DeploymentResourceRow, observation: ServingObservation) {
  const desiredEnv = resource.config.env;
  const actualEnv = observation.config.env;
  if (!desiredEnv || typeof desiredEnv !== 'object' || !actualEnv || typeof actualEnv !== 'object')
    return false;
  return (
    observation.config.image === resource.config.image &&
    'MF_ATTEMPT_ID' in actualEnv &&
    actualEnv.MF_ATTEMPT_ID === resource.attempt_id &&
    'MF_REVISION_ID' in actualEnv &&
    actualEnv.MF_REVISION_ID === resource.revision_id &&
    'MF_MODEL_CONFIG' in actualEnv &&
    'MF_MODEL_CONFIG' in desiredEnv &&
    actualEnv.MF_MODEL_CONFIG === desiredEnv.MF_MODEL_CONFIG
  );
}
