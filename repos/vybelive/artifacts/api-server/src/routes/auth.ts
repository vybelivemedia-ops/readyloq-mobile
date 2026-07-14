import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual, randomUUID, randomBytes } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";
import {
  RegisterBody,
  LoginBody,
  RefreshTokenBody,
  LogoutBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  requireAuth,
} from "../middlewares/auth";
import { reactivateAccount, AUDIT } from "../services/accountLifecycle.js";

const router = Router();

// ── Token hashing helpers ────────────────────────────────────────────────
//
// Passwords use bcrypt (intentionally slow, brute-force resistant).
// Refresh tokens use SHA-256 (tokens are already high-entropy, speed is fine,
// and bcrypt's variable-time comparison is wrong for token equality checks).
// Comparison uses timingSafeEqual to prevent timing-oracle attacks.

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeCompareTokenHashes(presented: string, stored: string): boolean {
  try {
    const a = Buffer.from(presented, "hex");
    const b = Buffer.from(stored, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Response shaping ──────────────────────────────────────────────────────

function toPublicUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _pw, refreshTokenHash: _rt, ...pub } = user;
  void _pw;
  void _rt;
  return pub;
}

// ── POST /api/auth/register ───────────────────────────────────────────────

router.post("/auth/register", async (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { email, password, username, displayName, bio } = parsed.data;

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = randomUUID();

  const [user] = await db
    .insert(usersTable)
    .values({
      id: userId,
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      displayName,
      bio: bio ?? null,
      passwordHash,
    })
    .returning();

  const authPayload = { userId: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
  const accessToken = signAccessToken(authPayload);
  const refreshToken = signRefreshToken(authPayload);
  const refreshTokenHash = hashRefreshToken(refreshToken);

  await db
    .update(usersTable)
    .set({ refreshTokenHash })
    .where(eq(usersTable.id, user.id));

  res.status(201).json({
    accessToken,
    refreshToken,
    user: toPublicUser(user),
  });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  // Constant-time guard: always run bcrypt.compare, even for non-existent users,
  // to prevent user-enumeration via login timing differences.
  // The placeholder is an intentional dummy hash — not a credential.
  // nosemgrep: detected-bcrypt-hash
  const DUMMY_HASH = "$2b$12$invalidhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  const passwordHash = user?.passwordHash ?? DUMMY_HASH;
  const valid = await bcrypt.compare(password, passwordHash);

  if (!user || !valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // A permanently deleted account cannot be signed into or recovered.
  if (user.accountStatus === "deleted") {
    res.status(403).json({ error: "This account has been deleted and cannot be recovered." });
    return;
  }

  // Restore-on-signin: a pending_deletion or suspended account is reactivated
  // when the owner successfully authenticates. This satisfies the Google Play
  // requirement that an inactivity-suspended user can recover by signing in,
  // and gives self-requested deletions a simple in-grace-period cancellation.
  let restored: "deletion_cancelled" | "reactivated" | null = null;
  if (user.accountStatus === "pending_deletion" || user.accountStatus === "suspended") {
    restored = user.accountStatus === "pending_deletion" ? "deletion_cancelled" : "reactivated";
    await reactivateAccount({
      userId: user.id,
      actorType: "user",
      ipAddress: req.ip,
      action: user.accountStatus === "pending_deletion" ? AUDIT.DELETION_CANCELLED : AUDIT.REACTIVATED,
    });
  }

  const authPayload = { userId: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
  const accessToken = signAccessToken(authPayload);
  const refreshToken = signRefreshToken(authPayload);
  const refreshTokenHash = hashRefreshToken(refreshToken);

  const now = new Date();
  await db
    .update(usersTable)
    .set({ refreshTokenHash, lastLoginAt: now, lastActivityAt: now })
    .where(eq(usersTable.id, user.id));

  // Re-read so the response reflects the now-active status after any restore.
  const [fresh] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);

  res.json({ accessToken, refreshToken, user: toPublicUser(fresh ?? user), restored });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────
//
// Rotating refresh token flow:
//   1. Verify JWT signature and expiry (catches tampered/expired tokens)
//   2. Hash the presented token
//   3. Mint the new token pair
//   4. Atomic compare-and-swap UPDATE: set refreshTokenHash = newHash
//      WHERE id = userId AND refreshTokenHash = presentedHash
//      — only one concurrent request can win this UPDATE; the loser gets 0
//      rows back and is treated as a replay, which nulls the hash entirely
//      and forces re-login.
//
// This prevents concurrent-replay attacks where two requests carrying the same
// old token both read the stored hash before either write lands.

router.post("/auth/refresh", async (req, res) => {
  const parsed = RefreshTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(parsed.data.refreshToken);
  } catch {
    res.status(401).json({ error: "Invalid refresh token" });
    return;
  }

  const presentedHash = hashRefreshToken(parsed.data.refreshToken);

  // Issue new token pair before the DB write so we have the hash ready.
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1);

  if (!user || !user.refreshTokenHash) {
    res.status(401).json({ error: "Session not found" });
    return;
  }

  const authPayload = { userId: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
  const newAccessToken = signAccessToken(authPayload);
  const newRefreshToken = signRefreshToken(authPayload);
  const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

  // Atomic compare-and-swap: rotate the hash only if the stored value still
  // matches the presented token's hash.  Two concurrent requests with the same
  // old token can both read the user row, but only one UPDATE wins because the
  // WHERE condition includes the expected hash.  The other request gets 0 rows
  // back and is treated as a replay — the session is then fully invalidated.
  const rotated = await db
    .update(usersTable)
    .set({ refreshTokenHash: newRefreshTokenHash })
    .where(
      and(
        eq(usersTable.id, user.id),
        eq(usersTable.refreshTokenHash, presentedHash),
      ),
    )
    .returning({ id: usersTable.id });

  if (rotated.length === 0) {
    // Hash no longer matches — concurrent replay or already-rotated token.
    // Null the hash to force re-login and prevent further token use.
    await db
      .update(usersTable)
      .set({ refreshTokenHash: null })
      .where(eq(usersTable.id, user.id));
    res.status(401).json({ error: "Refresh token already used or revoked" });
    return;
  }

  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: toPublicUser(user),
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────
//
// Accepts the refresh token in the request body so revocation works even when
// the access token has already expired.  The refresh token is verified by JWT
// signature and then by hash comparison against the stored value, matching the
// same integrity check used by the refresh endpoint.  On any failure the
// endpoint still returns 204 to avoid leaking session state to callers.
//
// tokenVersion is incremented atomically with the refresh token clear so that
// any still-valid access tokens issued before logout are immediately rejected
// by requireAuth's DB version check.

router.post("/auth/logout", async (req, res) => {
  const parsed = LogoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(204).send();
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(parsed.data.refreshToken);
  } catch {
    res.status(204).send();
    return;
  }

  const presentedHash = hashRefreshToken(parsed.data.refreshToken);

  // Clear the refresh token hash and increment tokenVersion so any outstanding
  // access tokens for this session are rejected by requireAuth's version check.
  // The WHERE condition prevents an attacker from logging out an active session
  // using an old/stolen token that has already been rotated away.
  await db
    .update(usersTable)
    .set({
      refreshTokenHash: null,
      tokenVersion: sql`${usersTable.tokenVersion} + 1`,
    })
    .where(
      and(
        eq(usersTable.id, payload.userId),
        eq(usersTable.refreshTokenHash, presentedHash),
      ),
    );

  res.status(204).send();
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.auth!.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(toPublicUser(user));
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────
//
// Issues a one-time reset token valid for 1 hour.
// The raw token is never returned to the client — it must be delivered out-of-band
// (e.g. email). Wire up an email provider here and send rawToken to the user's inbox.

router.post("/auth/forgot-password", async (req, res) => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const email = parsed.data.email.toLowerCase().trim();

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  // Always return the same response to prevent email enumeration timing attacks
  if (!user) {
    res.json({ message: "If that email exists, a reset link has been sent." });
    return;
  }

  // Invalidate any previous tokens for this user
  await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, user.id));

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 3600_000); // 1 hour

  await db.insert(passwordResetTokensTable).values({
    id: randomUUID(),
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  req.log.info({ userId: user.id }, "Password reset token issued");

  // Security: the raw token is NEVER returned in the API response.
  // It must be delivered exclusively via email to the verified address.
  // In non-production, log it at debug level so engineers can test the
  // flow before an email service is wired up.
  if (process.env["NODE_ENV"] !== "production") {
    req.log.debug(
      { userId: user.id, resetToken: rawToken },
      "[DEV ONLY] Password reset token — wire email delivery before production",
    );
  }
  res.json({ message: "If that email exists, a reset link has been sent." });
});

// ── POST /api/auth/reset-password ────────────────────────────────────────
//
// Validates the reset token, updates the password, and issues a new session.
// The stored refresh token is cleared and tokenVersion is incremented so all
// pre-reset access tokens are immediately rejected by requireAuth's version check.

router.post("/auth/reset-password", async (req, res) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Token and a password of at least 8 characters are required" });
    return;
  }

  const { token, password } = parsed.data;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const [resetRecord] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!resetRecord) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }
  if (resetRecord.usedAt) {
    res.status(400).json({ error: "Reset token has already been used" });
    return;
  }
  if (resetRecord.expiresAt < new Date()) {
    res.status(400).json({ error: "Reset token has expired" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, resetRecord.userId))
    .limit(1);

  if (!user) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  const passwordHash = await bcrypt.hash(String(password), 12);

  // Update password, revoke all existing sessions, increment tokenVersion to
  // invalidate any outstanding access tokens, and mark the reset token used.
  await db
    .update(usersTable)
    .set({
      passwordHash,
      refreshTokenHash: null,
      tokenVersion: sql`${usersTable.tokenVersion} + 1`,
    })
    .where(eq(usersTable.id, user.id));
  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokensTable.id, resetRecord.id));

  // Re-read user to get the new tokenVersion for the fresh session
  const [updatedUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);

  const authPayload = {
    userId: updatedUser.id,
    email: updatedUser.email,
    role: updatedUser.role,
    tokenVersion: updatedUser.tokenVersion,
  };
  const newAccessToken = signAccessToken(authPayload);
  const newRefreshToken = signRefreshToken(authPayload);
  const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

  await db
    .update(usersTable)
    .set({ refreshTokenHash: newRefreshTokenHash })
    .where(eq(usersTable.id, updatedUser.id));

  req.log.info({ userId: updatedUser.id }, "Password reset successful");

  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: toPublicUser(updatedUser),
  });
});

export default router;
