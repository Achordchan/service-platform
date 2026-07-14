const AVATAR_PALETTE = [
  { bg: "#DBEAFE", fg: "#1D4ED8" },
  { bg: "#E0E7FF", fg: "#4338CA" },
  { bg: "#EDE9FE", fg: "#6D28D9" },
  { bg: "#FCE7F3", fg: "#BE185D" },
  { bg: "#FFE4E6", fg: "#BE123C" },
  { bg: "#FFEDD5", fg: "#C2410C" },
  { bg: "#FEF3C7", fg: "#B45309" },
  { bg: "#DCFCE7", fg: "#15803D" },
  { bg: "#CCFBF1", fg: "#0F766E" },
  { bg: "#E0F2FE", fg: "#0369A1" },
] as const;

function hashSeed(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function getAvatarPalette(seed: string) {
  return AVATAR_PALETTE[hashSeed(seed) % AVATAR_PALETTE.length]!;
}

export function getAvatarInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

export function getDefaultAvatarDataUrl(name: string, seed = name) {
  const palette = getAvatarPalette(seed || name || "user");
  const initials = getAvatarInitials(name || "用户");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${palette.bg}"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="52" font-weight="650" fill="${palette.fg}">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function resolveAvatarSrc(
  image: string | null | undefined,
  name: string,
  seed?: string,
) {
  if (image && image.trim()) return image;
  return getDefaultAvatarDataUrl(name, seed ?? name);
}
