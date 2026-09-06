/** A URL query can select an internal page, never an external sign-in destination. */
export function authReturnPath(value: string | null | undefined, origin: string) {
  try {
    const destination = new URL(value || '/', origin);
    if (destination.origin === origin) return destination.pathname + destination.search;
  } catch {
    // Malformed pasted links must not prevent the user from signing in.
  }
  return '/';
}
