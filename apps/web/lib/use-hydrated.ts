'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Click actions stay unavailable until their handlers attach, without timers or listeners.
 * See docs/features/dashboard/implementation.md#shared-interactions. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
