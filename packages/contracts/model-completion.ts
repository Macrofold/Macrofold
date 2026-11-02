/** Only explicit provider/native finish reasons establish output truncation. */
export const modelOutputLimitExceeded = 'model_output_limit_exceeded';
export function isOutputLimitReason(reason: unknown): boolean {
  return (
    reason === 'length' ||
    reason === 'max_tokens' ||
    reason === 'max_output_tokens' ||
    reason === 'max-tokens'
  );
}
