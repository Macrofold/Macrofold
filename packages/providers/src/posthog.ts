import { assert } from '../../core/src/errors';
export type AnalyticsEvent = {
  uuid: string;
  event: string;
  timestamp: string;
  properties: Record<string, unknown>;
};
export interface AnalyticsSink {
  send(events: AnalyticsEvent[]): Promise<void>;
}
/** The public batch endpoint needs only a project token. No personal-query key is required. */
export class PostHogSink implements AnalyticsSink {
  async send(batch: AnalyticsEvent[]) {
    const region = process.env.POSTHOG_REGION || 'us';
    assert(
      ['us', 'eu'].includes(region) && process.env.POSTHOG_PROJECT_TOKEN,
      503,
      'analytics_not_configured',
      'Configure a PostHog region and project token.',
    );
    const response = await fetch(`https://${region}.i.posthog.com/batch/`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.POSTHOG_PROJECT_TOKEN, batch }),
    });
    try {
      assert(response.ok, 502, 'analytics_delivery_failed', 'Analytics delivery will retry.');
    } finally {
      await response.body?.cancel();
    }
  }
}
