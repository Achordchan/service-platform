function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export function buildSpaceSlug(name: string, preferred?: string | null) {
  const source = (preferred || name).trim().toLowerCase();
  const normalized = source
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  if (normalized.length >= 2) {
    return normalized;
  }

  return `space-${randomSuffix()}`;
}

export function nextSlugCandidate(base: string, attempt: number) {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, Math.max(2, 80 - suffix.length))}${suffix}`;
}
