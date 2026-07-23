export const REQUEST_AUTO_CLOSE_DAYS = 7;

export function requestAutoCloseCutoff(now = new Date()) {
  return new Date(
    now.getTime() - REQUEST_AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function isResolvedRequestDueForAutoClose(
  status: string,
  resolvedAt: Date | null,
  now = new Date(),
) {
  return (
    status === "RESOLVED" &&
    resolvedAt !== null &&
    resolvedAt <= requestAutoCloseCutoff(now)
  );
}
