const crypto = require("crypto");

const DEFAULT_TTL_MINUTES = 15;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 10;
const HOST_DEVICE_ID_RE = /^[a-zA-Z0-9_-]{3,80}$/;

const sessions = new Map();
const rateBuckets = new Map();

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getSessionTtlMs() {
  return (
    safeNumber(
      process.env.FAMILY_SESSION_TTL_MINUTES,
      DEFAULT_TTL_MINUTES,
      1,
      60,
    ) *
    60 *
    1000
  );
}

function getRateLimitWindowMs() {
  return safeNumber(
    process.env.FAMILY_SESSION_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
    60 * 1000,
    60 * 60 * 1000,
  );
}

function getRateLimitMax() {
  return safeNumber(
    process.env.FAMILY_SESSION_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_MAX,
    1,
    100,
  );
}

function getConfiguredCodeHash() {
  const configuredHash = String(process.env.FAMILY_ACCESS_CODE_HASH || "")
    .trim()
    .toLowerCase();

  if (/^[a-f0-9]{64}$/.test(configuredHash)) {
    return configuredHash;
  }

  const localCode = String(process.env.FAMILY_ACCESS_CODE || "").trim();
  return localCode ? sha256(localCode) : "";
}

function validateHostDeviceId(hostDeviceId) {
  const safeHostDeviceId = String(hostDeviceId || "").trim();
  if (!HOST_DEVICE_ID_RE.test(safeHostDeviceId)) {
    return null;
  }

  return safeHostDeviceId;
}

function pruneExpiredSessions(now = Date.now()) {
  for (const [sessionId, session] of sessions.entries()) {
    if (!session || session.expiresAtMs <= now) {
      sessions.delete(sessionId);
    }
  }
}

function checkRateLimit(key, now = Date.now()) {
  const windowMs = getRateLimitWindowMs();
  const maxAttempts = getRateLimitMax();
  const bucketKey = String(key || "unknown").slice(0, 120);
  const bucket = rateBuckets.get(bucketKey) || {
    count: 0,
    resetAt: now + windowMs,
  };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);

  return {
    allowed: bucket.count <= maxAttempts,
    resetAt: bucket.resetAt,
  };
}

function createFamilySession({ familyCode, hostDeviceId, ip }) {
  const now = Date.now();
  pruneExpiredSessions(now);

  const safeHostDeviceId = validateHostDeviceId(hostDeviceId);
  if (!safeHostDeviceId) {
    return { ok: false, status: 400, error: "invalid_host_device_id" };
  }

  const rateLimit = checkRateLimit(ip, now);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: "rate_limited",
      retryAfterMs: Math.max(0, rateLimit.resetAt - now),
    };
  }

  const expectedHash = getConfiguredCodeHash();
  if (!expectedHash) {
    return {
      ok: false,
      status: 503,
      error: "family_access_not_configured",
    };
  }

  const providedHash = sha256(String(familyCode || "").trim());
  if (
    providedHash.length !== expectedHash.length ||
    !crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(expectedHash))
  ) {
    return { ok: false, status: 401, error: "invalid_family_code" };
  }

  const sessionId = `family_${crypto.randomUUID()}`;
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const expiresAtMs = now + getSessionTtlMs();
  const session = {
    sessionId,
    hostDeviceId: safeHostDeviceId,
    tokenHash: sha256(sessionToken),
    createdAtMs: now,
    expiresAtMs,
  };

  sessions.set(sessionId, session);

  return {
    ok: true,
    sessionId,
    sessionToken,
    hostDeviceId: safeHostDeviceId,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

function verifyFamilySession({ sessionId, sessionToken, hostDeviceId }) {
  const now = Date.now();
  pruneExpiredSessions(now);

  const session = sessions.get(String(sessionId || ""));
  if (!session) {
    return { ok: false, status: 401, error: "invalid_session" };
  }

  if (hostDeviceId && validateHostDeviceId(hostDeviceId) !== session.hostDeviceId) {
    return { ok: false, status: 401, error: "invalid_session_host" };
  }

  if (session.expiresAtMs <= now) {
    sessions.delete(session.sessionId);
    return { ok: false, status: 401, error: "session_expired" };
  }

  const providedHash = sha256(String(sessionToken || ""));
  if (
    providedHash.length !== session.tokenHash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(providedHash),
      Buffer.from(session.tokenHash),
    )
  ) {
    return { ok: false, status: 401, error: "invalid_session_token" };
  }

  return {
    ok: true,
    sessionId: session.sessionId,
    hostDeviceId: session.hostDeviceId,
    expiresAt: new Date(session.expiresAtMs).toISOString(),
  };
}

module.exports = {
  createFamilySession,
  verifyFamilySession,
};
