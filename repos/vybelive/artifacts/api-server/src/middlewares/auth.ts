import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createHmac, randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// ── Startup secret validation ────────────────────────────────────────────
// This module throws at load time if SESSION_SECRET is absent.
// The server process cannot start safely without it.
const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET environment variable is required. " +
      "Server cannot start without a signing secret. " +
      "Set it via Replit Secrets.",
  );
}

// Derive two cryptographically independent secrets from the base secret.
// Using HMAC with distinct labels prevents token-type confusion attacks:
// a refresh token cannot be accepted where an access token is expected.
const ACCESS_SECRET = createHmac("sha256", SESSION_SECRET)
  .update("vybe:access-token:v1")
  .digest("hex");

const REFRESH_SECRET = createHmac("sha256", SESSION_SECRET)
  .update("vybe:refresh-token:v1")
  .digest("hex");

// ── Public types ─────────────────────────────────────────────────────────

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
  tokenVersion: number;
  // Populated by requireAuth from the live DB row (not carried in the JWT).
  accountStatus?: string;
}

// Internal payload shapes — the `type` claim prevents cross-use of tokens.
// `jti` (JWT ID) guarantees each token is unique even when two tokens are
// issued within the same second with identical payloads. Without it,
// rotating refresh tokens fails: the "new" token is byte-for-byte identical
// to the old one, so the stored hash never actually changes.
interface AccessTokenClaims extends AuthPayload {
  type: "access";
  jti: string;
}

interface RefreshTokenClaims extends AuthPayload {
  type: "refresh";
  jti: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

// ── Token creation ───────────────────────────────────────────────────────

export function signAccessToken(payload: AuthPayload): string {
  const claims: AccessTokenClaims = { ...payload, type: "access", jti: randomUUID() };
  return jwt.sign(claims, ACCESS_SECRET, {
    expiresIn: "15m",
    algorithm: "HS256",
  });
}

export function signRefreshToken(payload: AuthPayload): string {
  const claims: RefreshTokenClaims = { ...payload, type: "refresh", jti: randomUUID() };
  return jwt.sign(claims, REFRESH_SECRET, {
    expiresIn: "30d",
    algorithm: "HS256",
  });
}

// ── Token verification ───────────────────────────────────────────────────

export function verifyAccessToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, ACCESS_SECRET, {
    algorithms: ["HS256"],
  }) as AccessTokenClaims;
  if (decoded.type !== "access") {
    throw new jwt.JsonWebTokenError("Wrong token type");
  }
  const { type: _type, jti: _jti, iat: _iat, exp: _exp, ...payload } = decoded as AccessTokenClaims & { iat?: number; exp?: number };
  void _type; void _jti; void _iat; void _exp;
  return payload;
}

export function verifyRefreshToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, REFRESH_SECRET, {
    algorithms: ["HS256"],
  }) as RefreshTokenClaims;
  if (decoded.type !== "refresh") {
    throw new jwt.JsonWebTokenError("Wrong token type");
  }
  const { type: _type, jti: _jti, iat: _iat, exp: _exp, ...payload } = decoded as RefreshTokenClaims & { iat?: number; exp?: number };
  void _type; void _jti; void _iat; void _exp;
  return payload;
}

// ── Middleware ───────────────────────────────────────────────────────────

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);

  let claims: AuthPayload;
  try {
    claims = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Verify the token version against the database to ensure the token has not
  // been invalidated by a logout or password reset.  This also re-reads the
  // current role from the database so that a privilege change (e.g. admin
  // demotion) takes effect immediately rather than waiting for token expiry.
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
      accountStatus: usersTable.accountStatus,
      lastActivityAt: usersTable.lastActivityAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, claims.userId))
    .limit(1);

  if (!user || user.tokenVersion !== claims.tokenVersion) {
    res.status(401).json({ error: "Session has been revoked" });
    return;
  }

  // A permanently deleted account must never authenticate, even with an
  // otherwise-valid token.  pending_deletion and suspended accounts are allowed
  // through so the holder can reach the recovery endpoints (reactivate /
  // cancel-deletion); feature routes gate further on req.auth.accountStatus.
  if (user.accountStatus === "deleted") {
    res.status(403).json({ error: "This account has been deleted" });
    return;
  }

  req.auth = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
    accountStatus: user.accountStatus,
  };

  // Throttled activity tracking: only write when stale (>6h) to avoid a DB
  // write on every request.  Fire-and-forget — never block the request.
  const STALE_MS = 6 * 60 * 60 * 1000;
  const last = user.lastActivityAt?.getTime() ?? 0;
  if (Date.now() - last > STALE_MS) {
    db.update(usersTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .catch(() => {
        /* activity tracking is best-effort */
      });
  }

  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  requireAuth(req, res, () => {
    if (req.auth?.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}

// Populates req.auth when a valid bearer token is present, but never rejects
// the request when it is missing or invalid. Used by public endpoints that
// tailor their response to the caller (e.g. an `isFollowing` flag on a public
// profile) without requiring authentication.
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }

  let claims: AuthPayload;
  try {
    claims = verifyAccessToken(authHeader.slice(7));
  } catch {
    next();
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
      accountStatus: usersTable.accountStatus,
    })
    .from(usersTable)
    .where(eq(usersTable.id, claims.userId))
    .limit(1);

  if (
    user &&
    user.tokenVersion === claims.tokenVersion &&
    user.accountStatus !== "deleted"
  ) {
    req.auth = {
      userId: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
      accountStatus: user.accountStatus,
    };
  }

  next();
}
