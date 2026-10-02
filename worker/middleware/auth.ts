import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type AuthVariables = { userEmail: string };

export type KeySetFactory = (teamDomain: string) => JWTVerifyGetKey;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

/** Production key set: Cloudflare Access team JWKS, cached per isolate. */
export const remoteKeySet: KeySetFactory = (teamDomain) => {
  let keySet = remoteKeySets.get(teamDomain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeySets.set(teamDomain, keySet);
  }
  return keySet;
};

/**
 * Verifies the Cloudflare Access JWT on every request (defense in depth: Access already
 * blocks unauthenticated traffic at the edge). Fails closed on any missing config.
 */
export function accessAuth(getKeySet: KeySetFactory = remoteKeySet): MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVariables;
}> {
  return async (c, next) => {
    const allowedEmail = c.env.ALLOWED_EMAIL?.trim().toLowerCase();

    // Local dev only: the flag lives in .dev.vars and is honoured only on loopback hosts.
    const devBypass = (c.env as { DEV_AUTH_BYPASS?: string }).DEV_AUTH_BYPASS === "true";
    if (devBypass) {
      if (LOCAL_HOSTNAMES.has(new URL(c.req.url).hostname) && allowedEmail) {
        c.set("userEmail", allowedEmail);
        return next();
      }
      // Never expected outside local dev: make a misconfigured deploy visible in the logs.
      console.error("auth: DEV_AUTH_BYPASS is set on a non-local host; ignoring it");
    }

    const teamDomain = c.env.ACCESS_TEAM_DOMAIN?.trim();
    const audience = c.env.ACCESS_AUD?.trim();
    if (!teamDomain || !audience || !allowedEmail) {
      console.error("auth: Access configuration missing");
      return c.json({ error: "unauthorized" }, 401);
    }

    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) return c.json({ error: "unauthorized" }, 401);

    try {
      const { payload } = await jwtVerify(token, getKeySet(teamDomain), {
        issuer: `https://${teamDomain}`,
        audience,
        algorithms: ["RS256"],
      });
      const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
      if (email !== allowedEmail) return c.json({ error: "unauthorized" }, 401);
      c.set("userEmail", email);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  };
}
