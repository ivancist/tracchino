import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";

export const TEST_TEAM = "test-team.cloudflareaccess.com";
export const TEST_AUD = "test-aud";
export const TEST_EMAIL = "owner@example.com";

/** A fake Cloudflare Access issuer: local RS256 key pair + JWKS. */
export async function createFakeAccess() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const jwks = createLocalJWKSet({ keys: [jwk] });

  async function sign(
    claims: Record<string, unknown> = {},
    opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string | number } = {},
  ) {
    return new SignJWT({ email: TEST_EMAIL, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(opts.iss ?? `https://${TEST_TEAM}`)
      .setAudience(opts.aud ?? TEST_AUD)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(opts.key ?? privateKey);
  }

  return { keySet: () => jwks, sign };
}
