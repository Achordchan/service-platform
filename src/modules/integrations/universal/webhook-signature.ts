import { createHmac, timingSafeEqual } from "node:crypto";

export function createUniversalWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function verifyUniversalWebhookSignature(input: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}) {
  if (!input.signature.startsWith("v1=")) return false;
  const expected = Buffer.from(
    createUniversalWebhookSignature(
      input.secret,
      input.timestamp,
      input.rawBody,
    ),
    "hex",
  );
  const actual = Buffer.from(input.signature.slice(3), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
