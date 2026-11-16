/**
 * An error that retrying won't fix (for example, not being a group admin). The scheduler
 * marks the item failed straight away instead of retrying it for several minutes.
 */
export class PermanentError extends Error {
  readonly permanent = true;
}

export function isPermanent(err: unknown): boolean {
  return Boolean((err as { permanent?: boolean } | undefined)?.permanent);
}
