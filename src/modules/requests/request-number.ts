import { randomBytes } from "node:crypto";

export function generateRequestNumber(now = new Date()) {
  const date = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const entropy = randomBytes(5).toString("hex").toUpperCase();

  return `SR-${date}-${entropy}`;
}
