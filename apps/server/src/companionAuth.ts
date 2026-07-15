import { randomBytes, timingSafeEqual } from "node:crypto";

const companionToken = randomBytes(32).toString("base64url");

export function issueCompanionToken() {
  return companionToken;
}

export function isValidCompanionToken(candidate?: string | null) {
  if (!candidate) return false;
  const expected = Buffer.from(companionToken);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
