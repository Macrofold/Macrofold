import { dispatchTriggerDelivery } from '../../packages/core/src/trigger-dispatch';
import { SlackClient } from '../../packages/providers/src/slack';
import { config } from '../../packages/core/src/config';

if (config.mode !== 'local' || config.execution !== 'simulator' || config.allowPaid)
  throw new Error('The crash fixture requires unpaid local simulation.');
const [org, delivery] = process.argv.slice(2);
const slack = new SlackClient(async () => {
  // The sending lease is committed before this transport is reached. Do not contact Slack.
  process.send?.({ boundary: 'reply-request' });
  await new Promise<void>(() => {
    setInterval(() => {}, 1000);
  });
  throw new Error('Unreachable');
});
await dispatchTriggerDelivery(org, delivery, slack);
