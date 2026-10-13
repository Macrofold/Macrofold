/** Untrusted pagination must end, including when every page has a new cursor.
 * Reaching the limit rejects the incomplete result rather than silently truncating it. */
export class PaginationCursor {
  private readonly seen = new Set<string>();
  private pages = 0;
  constructor(private readonly maximumPages = 1000) {
    if (!Number.isSafeInteger(maximumPages) || maximumPages < 1)
      throw new RangeError('The page limit must be a positive, finite integer.');
  }
  next(cursor: string | null | undefined): string | undefined {
    this.pages++;
    if (!cursor) return undefined;
    if (this.pages >= this.maximumPages || this.seen.has(cursor))
      throw new Error(
        'Pagination repeated a cursor or exceeded its page limit. Narrow the request or use an ID.',
      );
    this.seen.add(cursor);
    return cursor;
  }
}
