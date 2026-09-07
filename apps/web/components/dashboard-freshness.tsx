'use client';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dashboardRefreshBatch, followDashboardChanges } from '../lib/dashboard-freshness';

const identityEvent = 'dashboard-identity-changed';
/** Drop cached tenant data before navigation. Other open tabs use the newly
 * selected cookie too, so they must also close streams and reload their shell. */
export function dashboardIdentityChanged() {
  window.dispatchEvent(new Event(identityEvent));
  const channel = new BroadcastChannel(identityEvent);
  channel.postMessage('changed');
  channel.close();
}

export function DashboardFreshness({ organization }: { organization?: string }) {
  const client = useQueryClient();
  const previous = useRef(organization);
  useEffect(() => {
    // /me reconciliation can detect a cookie changed in another tab even if its
    // BroadcastChannel message was missed while this tab was suspended.
    if (previous.current && previous.current !== organization) {
      client.clear();
      location.reload();
      return;
    }
    previous.current = organization;
    const controller = new AbortController();
    const batch = dashboardRefreshBatch(client);
    let stopped = false;
    const reconcile = () => {
      if (document.visibilityState === 'visible') batch.add('all');
    };
    const interval = setInterval(reconcile, 60000 + Math.random() * 10000);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      batch.stop();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', reconcile);
    };
    const clear = () => {
      stop();
      client.clear();
    };
    const reload = () => {
      clear();
      location.reload();
    };
    const channel = new BroadcastChannel(identityEvent);
    channel.onmessage = reload;
    window.addEventListener(identityEvent, clear);
    document.addEventListener('visibilitychange', reconcile);
    // Initial refresh does not depend on the streaming route being available.
    batch.add('all');
    // Reconciliation also retries an initially unavailable /me request. Only the
    // authenticated organization subscription depends on that request succeeding.
    if (organization)
      void followDashboardChanges(organization, {
        signal: controller.signal,
        refresh: batch.add,
        accessChanged: reload,
      });
    return () => {
      stop();
      channel.close();
      window.removeEventListener(identityEvent, clear);
    };
  }, [organization, client]);
  return null;
}
