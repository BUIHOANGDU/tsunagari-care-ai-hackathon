const express = require("express");

const {
  createFamilySession,
  verifyFamilySession,
} = require("../lib/familySessionService");

const router = express.Router();

function getRequestIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

router.post("/session", (req, res) => {
  const result = createFamilySession({
    familyCode: req.body?.familyCode,
    hostDeviceId: req.body?.hostDeviceId,
    ip: getRequestIp(req),
  });

  if (!result.ok) {
    console.warn(
      `[FamilySession] create rejected hostDeviceId=${String(
        req.body?.hostDeviceId || "",
      ).slice(0, 80)} reason=${result.error}`,
    );
    return res.status(result.status || 400).json(result);
  }

  console.log(`[FamilySession] created hostDeviceId=${result.hostDeviceId}`);
  return res.status(201).json(result);
});

router.post("/session/verify", (req, res) => {
  const result = verifyFamilySession({
    sessionId: req.body?.sessionId,
    sessionToken: req.body?.sessionToken,
    hostDeviceId: req.body?.hostDeviceId,
  });

  if (!result.ok) {
    console.warn(`[FamilySession] verify rejected reason=${result.error}`);
    return res.status(result.status || 401).json(result);
  }

  return res.status(200).json(result);
});

module.exports = router;
