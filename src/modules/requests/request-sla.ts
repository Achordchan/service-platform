const MILLISECONDS_PER_MINUTE = 60_000;

export function calculateRequestDueAt(
  slaResolutionMinutes: number | null | undefined,
  createdAt = new Date(),
) {
  if (
    typeof slaResolutionMinutes !== "number" ||
    !Number.isSafeInteger(slaResolutionMinutes) ||
    slaResolutionMinutes <= 0
  ) {
    return null;
  }
  return new Date(
    createdAt.getTime() + slaResolutionMinutes * MILLISECONDS_PER_MINUTE,
  );
}
