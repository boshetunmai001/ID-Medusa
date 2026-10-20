import { randomBytes } from "node:crypto";

// Encvoy 3.6.19's default user-password policy allows 8–32 characters.
// Its stored charset expression also rejects hyphens. The replacement is
// bijective within base64url, retaining 144 random bits and required classes.
export function fixturePassword() {
  return `Aa1!${randomBytes(18).toString("base64url").replaceAll("-", "!")}`;
}
