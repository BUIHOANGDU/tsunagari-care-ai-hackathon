(function (root) {
  const STATES = {
    INITIALIZING: "INITIALIZING",
    NO_PERSON: "NO_PERSON",
    POSE_UNCERTAIN: "POSE_UNCERTAIN",
    NORMAL: "NORMAL",
    BENDING: "BENDING",
    SITTING: "SITTING",
    CONTROLLED_DESCENT: "CONTROLLED_DESCENT",
    CONTROLLED_LYING: "CONTROLLED_LYING",
    SLEEPING: "SLEEPING",
    FALL_CANDIDATE: "FALL_CANDIDATE",
    VERIFYING: "VERIFYING",
    CONFIRMED_FALL: "CONFIRMED_FALL",
    RECOVERING: "RECOVERING",
    RECOVERED: "RECOVERED",
    COOLDOWN: "COOLDOWN",
  };

  const REASONS = {
    RAPID_DESCENT: "RAPID_DESCENT",
    SLOW_COLLAPSE: "SLOW_COLLAPSE",
    TORSO_ROTATION: "TORSO_ROTATION",
    HEIGHT_DROP: "HEIGHT_DROP",
    RAPID_HIP_DESCENT: "RAPID_HIP_DESCENT",
    HIP_DROP: "HIP_DROP",
    NEAR_FLOOR: "NEAR_FLOOR",
    HORIZONTAL_POSTURE: "HORIZONTAL_POSTURE",
    POST_FALL_IMMOBILE: "POST_FALL_IMMOBILE",
    BENDING_WITH_LEG_SUPPORT: "BENDING_WITH_LEG_SUPPORT",
    INSIDE_BED_ZONE: "INSIDE_BED_ZONE",
    INSIDE_SOFA_ZONE: "INSIDE_SOFA_ZONE",
    CONTROLLED_DESCENT: "CONTROLLED_DESCENT",
    POSE_UNCERTAIN: "POSE_UNCERTAIN",
    CAMERA_WARMUP: "CAMERA_WARMUP",
    RECOVERED: "RECOVERED",
    ROBOT_CONFIRMED_SAFE: "ROBOT_CONFIRMED_SAFE",
    ROBOT_HELP_REQUEST: "ROBOT_HELP_REQUEST",
    ROBOT_NO_RESPONSE: "ROBOT_NO_RESPONSE",
  };

  const DEFAULT_CONFIG = {
    // Camera stabilization gate in ms. Initial tuning value.
    cameraWarmupMs: 8000,
    // Landmark visibility/presence gate. Initial tuning value.
    minLandmarkVisibility: 0.55,
    // Consecutive valid frames before movement can be scored. Initial tuning value.
    minValidPoseFrames: 10,
    // Grace period for brief MediaPipe dropout in ms. Initial tuning value.
    maxInvalidPoseGapMs: 800,
    // Grace period to retain a strong candidate during pose uncertainty.
    candidateUncertaintyGraceMs: 2500,
    // Rolling pose history size in ms. Initial tuning value.
    poseHistoryWindowMs: 4000,
    // Visual post-fall verification window in ms. Initial tuning value.
    postFallVerifyMs: 5000,
    // Robot response wait in ms after a verification command. Initial tuning value.
    robotResponseTimeoutMs: 12000,
    // Recovery grace after a candidate in ms. Initial tuning value.
    recoveryGraceMs: 8000,
    // Alert and robot dedup cooldown in ms. Initial tuning value.
    alertCooldownMs: 90000,
    // Render-only landmark count gate. Initial tuning value.
    minRenderableLandmarks: 8,
    // Fallback floor thresholds as normalized Y. Initial tuning values.
    fallbackFloorHipY: 0.68,
    fallbackFloorBodyY: 0.66,
    // Minimum normalized hip-to-ankle span for upright leg support.
    minStandingLegSpan: 0.22,
    // Normalized body-center descent speed per second. Initial tuning value.
    rapidDescentSpeed: 0.42,
    // Normalized hip descent evidence thresholds. Initial tuning values.
    minHipDropForFall: 0.14,
    rapidHipDescentSpeed: 0.28,
    // Normalized slow-collapse descent over history. Initial tuning value.
    slowCollapseDrop: 0.18,
    // Slow controlled descent speed ceiling per second. Initial tuning value.
    controlledDescentMaxSpeed: 0.16,
    // Torso angle change threshold in degrees. Initial tuning value.
    torsoRotationDeltaDeg: 35,
    // Torso rotation speed threshold in degrees/sec. Initial tuning value.
    torsoRotationSpeedDegPerSec: 65,
    // Bounding-box height reduction ratio. Initial tuning value.
    heightDropRatio: 0.2,
    // Torso angle from vertical for horizontal posture. Initial tuning value.
    horizontalTorsoAngleDeg: 58,
    // Width/height ratio for horizontal posture. Initial tuning value.
    horizontalAspectRatio: 1.25,
    // Normalized center movement regarded as immobile per second. Initial tuning value.
    immobileSpeed: 0.055,
    // Max normalized Y for recovered upright center. Initial tuning value.
    recoveryBodyCenterY: 0.66,
    // Recent upright evidence window in ms. Initial tuning value.
    priorUprightWindowMs: 6000,
    fallCandidateScoreThreshold: 6,
    confirmedFallScoreThreshold: 8,
    scoreWeights: {
      rapidDescent: 3,
      slowCollapse: 2,
      torsoRotation: 2,
      heightDrop: 2,
      rapidHipDescent: 3,
      hipDrop: 2,
      horizontalPosture: 1,
      nearFloor: 3,
      postFallImmobile: 2,
      bendingWithLegSupportPenalty: -6,
      outsideSafeZone: 1,
      controlledDescentPenalty: -3,
      insideBedZonePenalty: -6,
      insideSofaZonePenalty: -4,
    },
  };

  const IMPORTANT_LANDMARKS = {
    leftShoulder: 11,
    rightShoulder: 12,
    leftHip: 23,
    rightHip: 24,
    leftKnee: 25,
    rightKnee: 26,
    leftAnkle: 27,
    rightAnkle: 28,
  };

  const STRONG_REASON_CODES = new Set([
    REASONS.RAPID_DESCENT,
    REASONS.SLOW_COLLAPSE,
    REASONS.TORSO_ROTATION,
    REASONS.HEIGHT_DROP,
    REASONS.RAPID_HIP_DESCENT,
    REASONS.HIP_DROP,
    REASONS.NEAR_FLOOR,
    REASONS.HORIZONTAL_POSTURE,
    REASONS.POST_FALL_IMMOBILE,
  ]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isValidLandmark(landmark, config) {
    if (!landmark) return false;
    if (!isFiniteNumber(landmark.x) || !isFiniteNumber(landmark.y)) return false;
    if (landmark.x < 0 || landmark.x > 1 || landmark.y < 0 || landmark.y > 1) {
      return false;
    }

    const visibility = landmark.visibility ?? landmark.presence ?? 1;
    const presence = landmark.presence ?? visibility;
    return (
      visibility >= config.minLandmarkVisibility &&
      presence >= config.minLandmarkVisibility
    );
  }

  function averagePoints(points) {
    const valid = points.filter(Boolean);
    if (!valid.length) return null;

    return {
      x: valid.reduce((sum, point) => sum + point.x, 0) / valid.length,
      y: valid.reduce((sum, point) => sum + point.y, 0) / valid.length,
    };
  }

  function centerOfPair(a, b) {
    return averagePoints([a, b]);
  }

  function distance(a, b) {
    if (!a || !b) return 0;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function mergeUnique(...reasonLists) {
    return Array.from(new Set(reasonLists.flat().filter(Boolean)));
  }

  function getStrongReasonCodes(reasons = []) {
    return reasons.filter((reason) => STRONG_REASON_CODES.has(reason));
  }

  function cloneSample(sample) {
    if (!sample) return null;
    return {
      timestamp: sample.timestamp,
      bodyCenterX: sample.bodyCenterX,
      bodyCenterY: sample.bodyCenterY,
      hipCenterY: sample.hipCenterY,
      kneeCenterY: sample.kneeCenterY,
      ankleCenterY: sample.ankleCenterY,
      legSpan: sample.legSpan,
      uprightLegSupport: sample.uprightLegSupport,
      shoulderCenterY: sample.shoulderCenterY,
      torsoAngle: sample.torsoAngle,
      bboxWidth: sample.bboxWidth,
      bboxHeight: sample.bboxHeight,
      bodyAspectRatio: sample.bodyAspectRatio,
      poseConfidence: sample.poseConfidence,
      floorProximity: sample.floorProximity,
      fallbackFloorProximity: sample.fallbackFloorProximity,
      zone: sample.zone,
      zoneId: sample.zoneId,
      movementSpeed: sample.movementSpeed,
      horizontalPosture: sample.horizontalPosture,
      fullBodyHorizontalPosture: sample.fullBodyHorizontalPosture,
      boundingBox: sample.boundingBox ? { ...sample.boundingBox } : null,
      bodyCenter: sample.bodyCenter ? { ...sample.bodyCenter } : null,
      hipCenter: sample.hipCenter ? { ...sample.hipCenter } : null,
      kneeCenter: sample.kneeCenter ? { ...sample.kneeCenter } : null,
      ankleCenter: sample.ankleCenter ? { ...sample.ankleCenter } : null,
      shoulderCenter: sample.shoulderCenter ? { ...sample.shoulderCenter } : null,
      validLandmarkCount: sample.validLandmarkCount,
    };
  }

  function refreshCandidateEvidence(candidate, sample, scoring, now, config) {
    const previousPeakScore = candidate.peakScore;
    candidate.currentScore = scoring.score;
    candidate.peakScore = Math.max(candidate.peakScore, scoring.score);
    candidate.score = candidate.peakScore;
    candidate.reasons = mergeUnique(candidate.reasons, scoring.reasons);
    candidate.peakReasons = mergeUnique(
      candidate.peakReasons,
      getStrongReasonCodes(scoring.reasons),
    );
    candidate.zone = sample.zone;
    candidate.lastSample = cloneSample(sample);
    candidate.poseUncertainStartedAt = null;

    if (
      scoring.score >= config.fallCandidateScoreThreshold ||
      candidate.peakScore > previousPeakScore ||
      getStrongReasonCodes(scoring.reasons).some((reason) =>
        [
          REASONS.RAPID_DESCENT,
          REASONS.SLOW_COLLAPSE,
          REASONS.TORSO_ROTATION,
          REASONS.HEIGHT_DROP,
        ].includes(reason),
      )
    ) {
      candidate.lastStrongEvidenceAt = now;
    }
  }

  function getValidPoint(landmarks, index, config) {
    const landmark = landmarks?.[index];
    return isValidLandmark(landmark, config)
      ? { x: landmark.x, y: landmark.y, visibility: landmark.visibility ?? 1 }
      : null;
  }

  function classifyZone(point, zones) {
    if (!point || !Array.isArray(zones)) return null;

    return zones.find((zone) => {
      if (!Array.isArray(zone?.points) || zone.points.length < 4) return false;
      const xs = zone.points.map((zonePoint) => zonePoint.x);
      const ys = zone.points.map((zonePoint) => zonePoint.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    }) || null;
  }

  function extractPoseSample(landmarks, now, zones, config) {
    if (!Array.isArray(landmarks) || !landmarks.length || !isFiniteNumber(now)) {
      return { valid: false, missingPerson: true, reason: STATES.NO_PERSON };
    }

    const leftShoulder = getValidPoint(landmarks, IMPORTANT_LANDMARKS.leftShoulder, config);
    const rightShoulder = getValidPoint(landmarks, IMPORTANT_LANDMARKS.rightShoulder, config);
    const leftHip = getValidPoint(landmarks, IMPORTANT_LANDMARKS.leftHip, config);
    const rightHip = getValidPoint(landmarks, IMPORTANT_LANDMARKS.rightHip, config);
    const leftKnee = getValidPoint(landmarks, IMPORTANT_LANDMARKS.leftKnee, config);
    const rightKnee = getValidPoint(landmarks, IMPORTANT_LANDMARKS.rightKnee, config);
    const leftAnkle = getValidPoint(landmarks, IMPORTANT_LANDMARKS.leftAnkle, config);
    const rightAnkle = getValidPoint(landmarks, IMPORTANT_LANDMARKS.rightAnkle, config);
    const shoulderCenter = centerOfPair(leftShoulder, rightShoulder);
    const hipCenter = centerOfPair(leftHip, rightHip);
    const kneeCenter = centerOfPair(leftKnee, rightKnee);
    const ankleCenter = centerOfPair(leftAnkle, rightAnkle);
    const bodyCenter = averagePoints([leftShoulder, rightShoulder, leftHip, rightHip]);
    const lowerBodyPoints = [leftKnee, rightKnee, leftAnkle, rightAnkle].filter(Boolean);
    const requiredPoints = [shoulderCenter, hipCenter, bodyCenter];

    if (requiredPoints.some((point) => !point) || lowerBodyPoints.length < 1) {
      return { valid: false, missingPerson: false, reason: STATES.POSE_UNCERTAIN };
    }

    const validLandmarks = landmarks.filter((landmark) => isValidLandmark(landmark, config));
    const xs = validLandmarks.map((landmark) => landmark.x);
    const ys = validLandmarks.map((landmark) => landmark.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bboxWidth = Math.max(0, maxX - minX);
    const bboxHeight = Math.max(0.001, maxY - minY);
    const bodyAspectRatio = bboxWidth / bboxHeight;
    const torsoDx = shoulderCenter.x - hipCenter.x;
    const torsoDy = shoulderCenter.y - hipCenter.y;
    const torsoAngle = Math.atan2(Math.abs(torsoDx), Math.abs(torsoDy)) * (180 / Math.PI);
    const poseConfidence =
      validLandmarks.reduce(
        (sum, landmark) => sum + (landmark.visibility ?? landmark.presence ?? 1),
        0,
      ) / Math.max(validLandmarks.length, 1);
    const zone = classifyZone(hipCenter, zones) || classifyZone(bodyCenter, zones);
    const hasFloorZone = Array.isArray(zones) && zones.some((item) => item.type === "floor");
    const inFallbackFloor =
      !hasFloorZone &&
      hipCenter.y >= config.fallbackFloorHipY &&
      bodyCenter.y >= config.fallbackFloorBodyY;
    const floorProximity = zone?.type === "floor" || inFallbackFloor ? 1 : 0;
    const lowerBodyLandmarksValid = Boolean(kneeCenter && ankleCenter);
    const legSpan = lowerBodyLandmarksValid ? ankleCenter.y - hipCenter.y : 0;
    const uprightLegSupport =
      lowerBodyLandmarksValid &&
      hipCenter.y < kneeCenter.y &&
      kneeCenter.y < ankleCenter.y &&
      legSpan >= config.minStandingLegSpan;
    const horizontalPosture =
      torsoAngle >= config.horizontalTorsoAngleDeg ||
      bodyAspectRatio >= config.horizontalAspectRatio;
    const fullBodyHorizontalPosture = bodyAspectRatio >= config.horizontalAspectRatio;

    return {
      valid: true,
      timestamp: now,
      bodyCenterX: bodyCenter.x,
      bodyCenterY: bodyCenter.y,
      hipCenterY: hipCenter.y,
      kneeCenterY: kneeCenter?.y ?? null,
      ankleCenterY: ankleCenter?.y ?? null,
      legSpan,
      uprightLegSupport,
      shoulderCenterY: shoulderCenter.y,
      torsoAngle,
      bboxWidth,
      bboxHeight,
      bodyAspectRatio,
      poseConfidence,
      floorProximity,
      fallbackFloorProximity: inFallbackFloor ? 1 : 0,
      zone: zone ? zone.type : inFallbackFloor ? "fallback_floor" : "none",
      zoneId: zone?.id || "",
      movementSpeed: 0,
      horizontalPosture,
      fullBodyHorizontalPosture,
      boundingBox: { minX, maxX, minY, maxY },
      bodyCenter,
      hipCenter,
      kneeCenter,
      ankleCenter,
      shoulderCenter,
      validLandmarkCount: validLandmarks.length,
    };
  }

  function getOldestSample(history) {
    return history.length ? history[0] : null;
  }

  function getDelta(history, sample) {
    const previous = getOldestSample(history);
    if (!previous || previous.timestamp >= sample.timestamp) {
      return {
        elapsedMs: 0,
        bodyCenterDeltaY: 0,
        hipCenterDeltaY: 0,
        hipDescentSpeed: 0,
        descentSpeed: 0,
        rotationDelta: 0,
        rotationSpeed: 0,
        heightDropRatio: 0,
        aspectRatioDelta: 0,
      };
    }

    const elapsedMs = sample.timestamp - previous.timestamp;
    const elapsedSeconds = elapsedMs / 1000;
    const bodyCenterDeltaY = sample.bodyCenterY - previous.bodyCenterY;
    const hipCenterDeltaY = sample.hipCenterY - previous.hipCenterY;
    const rotationDelta = Math.abs(sample.torsoAngle - previous.torsoAngle);
    const heightDropRatio =
      previous.bboxHeight > 0
        ? Math.max(0, (previous.bboxHeight - sample.bboxHeight) / previous.bboxHeight)
        : 0;

    return {
      elapsedMs,
      bodyCenterDeltaY,
      hipCenterDeltaY,
      hipDescentSpeed: elapsedSeconds > 0 ? hipCenterDeltaY / elapsedSeconds : 0,
      descentSpeed: elapsedSeconds > 0 ? bodyCenterDeltaY / elapsedSeconds : 0,
      rotationDelta,
      rotationSpeed: elapsedSeconds > 0 ? rotationDelta / elapsedSeconds : 0,
      heightDropRatio,
      aspectRatioDelta: sample.bodyAspectRatio - previous.bodyAspectRatio,
    };
  }

  function classifyPosture(sample, config, delta = null) {
    if (
      sample.torsoAngle >= config.horizontalTorsoAngleDeg * 0.52 &&
      sample.uprightLegSupport &&
      sample.hipCenterY < config.fallbackFloorHipY &&
      !(delta?.descentSpeed >= config.rapidDescentSpeed) &&
      !(delta?.hipCenterDeltaY >= config.minHipDropForFall) &&
      !sample.fullBodyHorizontalPosture
    ) {
      return "bending";
    }
    if (sample.horizontalPosture && sample.floorProximity) return "lying";
    if (sample.horizontalPosture) return "lying";
    if (sample.torsoAngle < 34 && sample.bodyAspectRatio < 1.1) {
      return sample.hipCenterY > 0.58 ? "sitting" : "standing";
    }
    if (sample.hipCenterY > 0.62) return "sitting";
    return "unknown";
  }

  function scoreFall(sample, delta, state, config) {
    const reasons = [];
    const weights = config.scoreWeights;
    let score = 0;

    if (delta.descentSpeed >= config.rapidDescentSpeed) {
      score += weights.rapidDescent;
      reasons.push(REASONS.RAPID_DESCENT);
    }

    if (
      delta.bodyCenterDeltaY >= config.slowCollapseDrop &&
      delta.descentSpeed > config.controlledDescentMaxSpeed * 0.6
    ) {
      score += weights.slowCollapse;
      reasons.push(REASONS.SLOW_COLLAPSE);
    }

    if (
      delta.rotationDelta >= config.torsoRotationDeltaDeg ||
      delta.rotationSpeed >= config.torsoRotationSpeedDegPerSec
    ) {
      score += weights.torsoRotation;
      reasons.push(REASONS.TORSO_ROTATION);
    }

    if (delta.heightDropRatio >= config.heightDropRatio) {
      score += weights.heightDrop;
      reasons.push(REASONS.HEIGHT_DROP);
    }

    if (delta.hipDescentSpeed >= config.rapidHipDescentSpeed) {
      score += weights.rapidHipDescent;
      reasons.push(REASONS.RAPID_HIP_DESCENT);
    }

    if (delta.hipCenterDeltaY >= config.minHipDropForFall) {
      score += weights.hipDrop;
      reasons.push(REASONS.HIP_DROP);
    }

    if (sample.horizontalPosture) {
      score += weights.horizontalPosture;
      reasons.push(REASONS.HORIZONTAL_POSTURE);
    }

    if (sample.floorProximity) {
      score += weights.nearFloor;
      reasons.push(REASONS.NEAR_FLOOR);
    }

    if (sample.movementSpeed <= config.immobileSpeed && state.candidateStartedAt) {
      score += weights.postFallImmobile;
      reasons.push(REASONS.POST_FALL_IMMOBILE);
    }

    if (sample.zone === "bed") {
      score += weights.insideBedZonePenalty;
      reasons.push(REASONS.INSIDE_BED_ZONE);
    } else if (sample.zone === "sofa") {
      score += weights.insideSofaZonePenalty;
      reasons.push(REASONS.INSIDE_SOFA_ZONE);
    } else {
      score += weights.outsideSafeZone;
    }

    const controlledDescent =
      delta.bodyCenterDeltaY > 0.08 &&
      delta.descentSpeed > 0 &&
      delta.descentSpeed <= config.controlledDescentMaxSpeed &&
      delta.rotationSpeed < config.torsoRotationSpeedDegPerSec * 0.55;

    if (controlledDescent) {
      score += weights.controlledDescentPenalty;
      reasons.push(REASONS.CONTROLLED_DESCENT);
    }

    const bendingWithLegSupport =
      sample.torsoAngle >= config.horizontalTorsoAngleDeg * 0.52 &&
      sample.uprightLegSupport &&
      sample.hipCenterY < config.fallbackFloorHipY &&
      delta.hipCenterDeltaY < config.minHipDropForFall &&
      delta.hipDescentSpeed < config.rapidHipDescentSpeed &&
      !sample.fullBodyHorizontalPosture;

    if (bendingWithLegSupport) {
      score += weights.bendingWithLegSupportPenalty;
      reasons.push(REASONS.BENDING_WITH_LEG_SUPPORT);
    }

    const movementEvidenceReasons = [
      REASONS.RAPID_DESCENT,
      REASONS.SLOW_COLLAPSE,
      REASONS.RAPID_HIP_DESCENT,
      REASONS.HIP_DROP,
      REASONS.TORSO_ROTATION,
    ];
    const endStateEvidenceReasons = [
      REASONS.NEAR_FLOOR,
      REASONS.HORIZONTAL_POSTURE,
      REASONS.POST_FALL_IMMOBILE,
    ];
    const movementEvidenceCount = movementEvidenceReasons.filter((reason) =>
      reasons.includes(reason),
    ).length;
    const endStateEvidenceCount = endStateEvidenceReasons.filter((reason) =>
      reasons.includes(reason),
    ).length;

    return {
      score: Math.max(0, Math.round(score)),
      reasons,
      controlledDescent,
      bendingWithLegSupport,
      movementEvidenceCount,
      endStateEvidenceCount,
    };
  }

  function createFallDetectionEngine(options = {}) {
    const config = {
      ...DEFAULT_CONFIG,
      ...options,
      scoreWeights: {
        ...DEFAULT_CONFIG.scoreWeights,
        ...(options.scoreWeights || {}),
      },
    };

    let state = STATES.INITIALIZING;
    let cameraStartedAt = Date.now();
    let history = [];
    let validPoseFrames = 0;
    let lastValidPoseAt = 0;
    let lastUprightAt = 0;
    let candidate = null;
    let lastResult = null;

    function setState(nextState, now) {
      const transition = state !== nextState ? { from: state, to: nextState, at: now } : null;
      state = nextState;
      return transition;
    }

    function reset(now = Date.now()) {
      state = STATES.INITIALIZING;
      cameraStartedAt = now;
      history = [];
      validPoseFrames = 0;
      lastValidPoseAt = 0;
      lastUprightAt = 0;
      candidate = null;
      lastResult = null;
    }

    function pruneHistory(now) {
      history = history.filter(
        (sample) => now - sample.timestamp <= config.poseHistoryWindowMs,
      );
    }

    function pushSample(sample) {
      const previous = history[history.length - 1];
      if (previous && sample.timestamp > previous.timestamp) {
        const elapsedSeconds = (sample.timestamp - previous.timestamp) / 1000;
        sample.movementSpeed =
          elapsedSeconds > 0
            ? distance(sample.bodyCenter, previous.bodyCenter) / elapsedSeconds
            : 0;
      }

      history.push(sample);
      pruneHistory(sample.timestamp);
    }

    function buildResult(sample, posture, scoring, transition, extra = {}) {
      const result = {
        state,
        transition,
        posture,
        sample,
        score: scoring?.score || 0,
        reasons: scoring?.reasons || [],
        zone: sample?.zone || "none",
        event: candidate ? { ...candidate } : null,
        warmupRemainingMs: Math.max(
          0,
          config.cameraWarmupMs -
            ((sample?.timestamp || Date.now()) - cameraStartedAt),
        ),
        verificationRemainingMs: 0,
        alertLevel: "none",
        visualConfirmationReady: false,
        diagnostics: scoring?.diagnostics || null,
        config,
        ...extra,
      };
      lastResult = result;
      return result;
    }

    function update({ landmarks, now = Date.now(), zones = [] } = {}) {
      const sampleResult = extractPoseSample(landmarks, now, zones, config);
      const inWarmup = now - cameraStartedAt < config.cameraWarmupMs;

      if (!sampleResult.valid) {
        validPoseFrames = 0;
        const invalidGapMs = lastValidPoseAt ? now - lastValidPoseAt : 0;
        const nextState = sampleResult.missingPerson ? STATES.NO_PERSON : STATES.POSE_UNCERTAIN;

        if (candidate) {
          const hasHighConfidenceEvidence =
            candidate.peakScore >= config.confirmedFallScoreThreshold;
          const elapsedMs = now - candidate.candidateStartedAt;
          const verificationRemainingMs = Math.max(0, config.postFallVerifyMs - elapsedMs);

          if (
            !hasHighConfidenceEvidence &&
            invalidGapMs > config.maxInvalidPoseGapMs
          ) {
            const cancelledEvent = {
              ...candidate,
              cancelledAt: now,
              cancelReason: REASONS.POSE_UNCERTAIN,
            };
            candidate = null;
            const transition = setState(nextState, now);
            return buildResult(
              null,
              "unknown",
              { score: 0, reasons: [REASONS.POSE_UNCERTAIN] },
              transition,
              {
                alertLevel: "none",
                event: cancelledEvent,
                warmupRemainingMs: Math.max(0, config.cameraWarmupMs - (now - cameraStartedAt)),
              },
            );
          }

          if (invalidGapMs <= config.candidateUncertaintyGraceMs) {
            candidate.poseUncertainStartedAt = candidate.poseUncertainStartedAt || now;
            const transition = setState(
              hasHighConfidenceEvidence ? STATES.VERIFYING : STATES.POSE_UNCERTAIN,
              now,
            );
            return buildResult(
              null,
              "unknown",
              {
                score: candidate.peakScore,
                reasons: mergeUnique(candidate.peakReasons, [REASONS.POSE_UNCERTAIN]),
              },
              transition,
              {
                alertLevel: "none",
                event: { ...candidate },
                verificationRemainingMs,
                warmupRemainingMs: Math.max(0, config.cameraWarmupMs - (now - cameraStartedAt)),
                zone: candidate.zone,
              },
            );
          }

          const cancelledEvent = {
            ...candidate,
            cancelledAt: now,
            cancelReason: REASONS.POSE_UNCERTAIN,
          };
          candidate = null;
          const transition = setState(nextState, now);
          return buildResult(
            null,
            "unknown",
            { score: 0, reasons: [REASONS.POSE_UNCERTAIN] },
            transition,
            {
              alertLevel: "none",
              event: cancelledEvent,
              warmupRemainingMs: Math.max(0, config.cameraWarmupMs - (now - cameraStartedAt)),
            },
          );
        }

        const transition = setState(inWarmup ? STATES.INITIALIZING : nextState, now);
        return buildResult(null, "unknown", { score: 0, reasons: [REASONS.POSE_UNCERTAIN] }, transition, {
          alertLevel: "none",
          warmupRemainingMs: Math.max(0, config.cameraWarmupMs - (now - cameraStartedAt)),
        });
      }

      const sample = sampleResult;
      lastValidPoseAt = now;
      validPoseFrames += 1;
      pushSample(sample);

      const delta = getDelta(history, sample);
      const posture = classifyPosture(sample, config, delta);
      if (posture === "standing" || posture === "sitting") {
        lastUprightAt = now;
      }

      if (inWarmup || (!candidate && validPoseFrames < config.minValidPoseFrames)) {
        const transition = setState(STATES.INITIALIZING, now);
        return buildResult(sample, posture, { score: 0, reasons: [REASONS.CAMERA_WARMUP] }, transition, {
          warmupRemainingMs: Math.max(0, config.cameraWarmupMs - (now - cameraStartedAt)),
        });
      }

      const scoring = scoreFall(sample, delta, { candidateStartedAt: candidate?.candidateStartedAt }, config);
      const meaningfulHipDescent =
        scoring.reasons.includes(REASONS.HIP_DROP) ||
        scoring.reasons.includes(REASONS.RAPID_HIP_DESCENT);
      const veryStrongWholeBodyDescent =
        delta.bodyCenterDeltaY >= config.slowCollapseDrop * 1.6 &&
        delta.descentSpeed >= config.rapidDescentSpeed * 1.1 &&
        !sample.uprightLegSupport;
      const bendingSuppressed =
        sample.uprightLegSupport &&
        posture === "bending" &&
        delta.hipCenterDeltaY < config.minHipDropForFall &&
        !scoring.reasons.includes(REASONS.RAPID_HIP_DESCENT);
      const candidateDiagnostics = {
        uprightLegSupport: sample.uprightLegSupport,
        hipCenterDeltaY: delta.hipCenterDeltaY,
        hipDescentSpeed: delta.hipDescentSpeed,
        floorProximity: sample.floorProximity,
        movementEvidenceCount: scoring.movementEvidenceCount,
        endStateEvidenceCount: scoring.endStateEvidenceCount,
        bendingSuppressed,
        candidateReady: false,
      };
      const wasRecentlyUpright = lastUprightAt && now - lastUprightAt <= config.priorUprightWindowMs;
      const safeLyingZone = sample.zone === "bed" || sample.zone === "sofa";
      const controlledLying =
        sample.horizontalPosture &&
        scoring.controlledDescent &&
        (safeLyingZone || !sample.floorProximity);
      const sleeping =
        safeLyingZone &&
        sample.horizontalPosture &&
        sample.movementSpeed <= config.immobileSpeed &&
        !scoring.reasons.includes(REASONS.RAPID_DESCENT);
      const recovered =
        candidate &&
        (posture === "standing" || posture === "sitting") &&
        sample.bodyCenterY <= config.recoveryBodyCenterY;

      if (candidate) {
        const elapsedMs = now - candidate.candidateStartedAt;
        const verifyingRemainingMs = Math.max(0, config.postFallVerifyMs - elapsedMs);

        if (recovered && elapsedMs <= config.recoveryGraceMs) {
          const transition = setState(STATES.RECOVERED, now);
          const recoveredEvent = { ...candidate, recoveredAt: now };
          candidate = null;
          return buildResult(sample, posture, { score: 0, reasons: [REASONS.RECOVERED] }, transition, {
            alertLevel: "recovered",
            event: recoveredEvent,
            verificationRemainingMs: 0,
          });
        }

        const effectiveScore = Math.max(candidate.peakScore, scoring.score);
        const enoughVisualEvidence =
          elapsedMs >= config.postFallVerifyMs &&
          effectiveScore >= config.confirmedFallScoreThreshold &&
          sample.floorProximity &&
          sample.horizontalPosture &&
          !safeLyingZone;

        refreshCandidateEvidence(candidate, sample, scoring, now, config);
        const effectiveReasons = mergeUnique(candidate.peakReasons, scoring.reasons);

        const transition = setState(STATES.VERIFYING, now);
        return buildResult(sample, posture, { score: effectiveScore, reasons: effectiveReasons }, transition, {
          alertLevel: enoughVisualEvidence ? "confirmed_fall" : "none",
          diagnostics: candidateDiagnostics,
          visualConfirmationReady: enoughVisualEvidence,
          verificationRemainingMs: verifyingRemainingMs,
        });
      }

      const candidateReady =
        wasRecentlyUpright &&
        scoring.score >= config.fallCandidateScoreThreshold &&
        sample.floorProximity &&
        scoring.movementEvidenceCount > 0 &&
        scoring.endStateEvidenceCount > 0 &&
        (meaningfulHipDescent || veryStrongWholeBodyDescent) &&
        !bendingSuppressed &&
        posture !== "bending" &&
        !safeLyingZone &&
        !scoring.controlledDescent;
      candidateDiagnostics.candidateReady = Boolean(candidateReady);

      if (candidateReady) {
        candidate = {
          eventId: `fall_${now}`,
          detectedAt: now,
          candidateStartedAt: now,
          score: scoring.score,
          currentScore: scoring.score,
          peakScore: scoring.score,
          reasons: scoring.reasons.slice(),
          peakReasons: getStrongReasonCodes(scoring.reasons),
          lastStrongEvidenceAt: now,
          initialSample: cloneSample(sample),
          lastSample: cloneSample(sample),
          poseUncertainStartedAt: null,
          zone: sample.zone,
          alertSent: false,
        };
        const transition = setState(STATES.FALL_CANDIDATE, now);
        return buildResult(sample, posture, scoring, transition, {
          alertLevel: "fall_candidate",
          diagnostics: candidateDiagnostics,
          verificationRemainingMs: config.postFallVerifyMs,
        });
      }

      let nextState = STATES.NORMAL;
      if (sleeping) {
        nextState = STATES.SLEEPING;
      } else if (controlledLying) {
        nextState = STATES.CONTROLLED_LYING;
      } else if (posture === "bending") {
        nextState = STATES.BENDING;
      } else if (scoring.controlledDescent) {
        nextState = STATES.CONTROLLED_DESCENT;
      } else if (posture === "sitting") {
        nextState = STATES.SITTING;
      }

      const transition = setState(nextState, now);
      return buildResult(sample, posture, scoring, transition, {
        diagnostics: candidateDiagnostics,
      });
    }

    function getState() {
      return state;
    }

    function getHistory() {
      return history.slice();
    }

    function getLastResult() {
      return lastResult;
    }

    return {
      getHistory,
      getLastResult,
      getState,
      reset,
      update,
    };
  }

  function createTestLandmarks(pointsByIndex) {
    const landmarks = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 0.05,
      presence: 0.05,
    }));

    Object.entries(pointsByIndex).forEach(([index, point]) => {
      landmarks[Number(index)] = {
        x: point.x,
        y: point.y,
        visibility: point.visibility ?? 0.95,
        presence: point.presence ?? point.visibility ?? 0.95,
      };
    });

    return landmarks;
  }

  function createStandingTestLandmarks() {
    return createTestLandmarks({
      11: { x: 0.44, y: 0.24 },
      12: { x: 0.56, y: 0.24 },
      23: { x: 0.46, y: 0.52 },
      24: { x: 0.54, y: 0.52 },
      25: { x: 0.46, y: 0.75 },
      26: { x: 0.54, y: 0.75 },
      27: { x: 0.46, y: 0.92 },
      28: { x: 0.54, y: 0.92 },
    });
  }

  function createFloorLyingTestLandmarks(y = 0.79) {
    return createTestLandmarks({
      11: { x: 0.18, y: y - 0.04 },
      12: { x: 0.18, y: y + 0.04 },
      23: { x: 0.62, y: y - 0.04 },
      24: { x: 0.62, y: y + 0.04 },
      25: { x: 0.78, y: y - 0.04 },
      26: { x: 0.78, y: y + 0.04 },
      27: { x: 0.92, y: y - 0.04 },
      28: { x: 0.92, y: y + 0.04 },
    });
  }

  function createBendingTestLandmarks({
    shoulderX = 0.34,
    shoulderY = 0.26,
    hipX = 0.5,
    hipY = 0.52,
    kneeY = 0.74,
    ankleY = 0.92,
  } = {}) {
    return createTestLandmarks({
      11: { x: shoulderX - 0.05, y: shoulderY },
      12: { x: shoulderX + 0.05, y: shoulderY },
      23: { x: hipX - 0.04, y: hipY },
      24: { x: hipX + 0.04, y: hipY },
      25: { x: hipX - 0.05, y: kneeY },
      26: { x: hipX + 0.05, y: kneeY },
      27: { x: hipX - 0.05, y: ankleY },
      28: { x: hipX + 0.05, y: ankleY },
    });
  }

  function createSquattingTestLandmarks() {
    return createTestLandmarks({
      11: { x: 0.43, y: 0.36 },
      12: { x: 0.57, y: 0.36 },
      23: { x: 0.45, y: 0.62 },
      24: { x: 0.55, y: 0.62 },
      25: { x: 0.38, y: 0.74 },
      26: { x: 0.62, y: 0.74 },
      27: { x: 0.34, y: 0.92 },
      28: { x: 0.66, y: 0.92 },
    });
  }

  function createKneelingTestLandmarks() {
    return createTestLandmarks({
      11: { x: 0.43, y: 0.31 },
      12: { x: 0.57, y: 0.31 },
      23: { x: 0.45, y: 0.58 },
      24: { x: 0.55, y: 0.58 },
      25: { x: 0.42, y: 0.78 },
      26: { x: 0.58, y: 0.78 },
      27: { x: 0.4, y: 0.84 },
      28: { x: 0.6, y: 0.84 },
    });
  }

  function createSlowCollapseEndLandmarks() {
    return createFloorLyingTestLandmarks(0.72);
  }

  function createBedZone() {
    return [
      {
        id: "test_bed",
        type: "bed",
        points: [
          { x: 0.1, y: 0.65 },
          { x: 0.95, y: 0.65 },
          { x: 0.95, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
    ];
  }

  function assertTest(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function createPeakScoreTestEngine() {
    return createFallDetectionEngine({
      cameraWarmupMs: 0,
      minValidPoseFrames: 1,
      poseHistoryWindowMs: 1000,
      postFallVerifyMs: 5000,
      scoreWeights: {
        slowCollapse: 0,
        heightDrop: 0,
        rapidHipDescent: 0,
        hipDrop: 0,
        outsideSafeZone: 0,
      },
    });
  }

  function createRegressionTestEngine(options = {}) {
    return createFallDetectionEngine({
      cameraWarmupMs: 0,
      minValidPoseFrames: 1,
      ...options,
    });
  }

  function getTestDiagnostics(result) {
    const diagnostics = result?.diagnostics || {};
    return {
      state: result?.state,
      posture: result?.posture,
      score: result?.score,
      reasons: result?.reasons || [],
      alertLevel: result?.alertLevel,
      uprightLegSupport: Boolean(
        diagnostics.uprightLegSupport ?? result?.sample?.uprightLegSupport,
      ),
      hipCenterDeltaY: Number((diagnostics.hipCenterDeltaY || 0).toFixed(3)),
      hipDescentSpeed: Number((diagnostics.hipDescentSpeed || 0).toFixed(3)),
      floorProximity: result?.sample?.floorProximity || 0,
      movementEvidenceCount: diagnostics.movementEvidenceCount || 0,
      endStateEvidenceCount: diagnostics.endStateEvidenceCount || 0,
      bendingSuppressed: Boolean(diagnostics.bendingSuppressed),
      candidateReady: Boolean(diagnostics.candidateReady),
    };
  }

  function runDeterministicTests({ throwOnFailure = false } = {}) {
    const results = [];
    const standing = createStandingTestLandmarks();
    const lying = createFloorLyingTestLandmarks();

    function test(name, callback) {
      try {
        const details = callback();
        results.push({ name, passed: true, details });
      } catch (error) {
        results.push({ name, passed: false, error: error.message });
      }
    }

    test("standing at startup", () => {
      const engine = createFallDetectionEngine({
        cameraWarmupMs: 8000,
        minValidPoseFrames: 1,
      });
      engine.reset(0);
      const result = engine.update({ landmarks: standing, now: 0 });
      assertTest(result.state === STATES.INITIALIZING, "standing startup should warm up");
      assertTest(result.alertLevel === "none", "standing startup should not alert");
      assertTest(!result.event, "standing startup should not create a candidate");
      return getTestDiagnostics(result);
    });

    test("horizontal pose during warm-up", () => {
      const engine = createFallDetectionEngine({
        cameraWarmupMs: 5000,
        minValidPoseFrames: 1,
      });
      engine.reset(0);
      const result = engine.update({ landmarks: lying, now: 1000 });
      assertTest(result.state === STATES.INITIALIZING, "horizontal warm-up should stay initializing");
      assertTest(result.alertLevel === "none", "horizontal warm-up should not alert");
      assertTest(!result.event, "horizontal warm-up should not create a candidate");
      return getTestDiagnostics(result);
    });

    test("standing upright", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      const result = engine.update({ landmarks: standing, now: 1 });
      assertTest(result.state === STATES.NORMAL, "standing should be normal");
      assertTest(result.sample?.floorProximity === 0, "standing feet near frame bottom should not be floor");
      assertTest(!result.diagnostics?.candidateReady, "standing should not be candidate-ready");
      return getTestDiagnostics(result);
    });

    test("bending 30 degrees", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const result = engine.update({
        landmarks: createBendingTestLandmarks(),
        now: 801,
      });
      assertTest(result.state === STATES.BENDING, "supported 30-degree bend should be BENDING");
      assertTest(result.alertLevel === "none", "bending should not alert");
      assertTest(!result.diagnostics?.candidateReady, "bending should not be candidate-ready");
      return getTestDiagnostics(result);
    });

    test("deep bending to pick up an object", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const result = engine.update({
        landmarks: createBendingTestLandmarks({
          shoulderX: 0.27,
          shoulderY: 0.6,
          hipY: 0.52,
          ankleY: 0.95,
        }),
        now: 801,
      });
      assertTest(result.state === STATES.BENDING, "deep supported bend should be BENDING");
      assertTest(result.sample?.floorProximity === 0, "deep bend should not use ankle maxY as floor");
      assertTest(!result.diagnostics?.candidateReady, "deep bend should not be candidate-ready");
      assertTest(result.diagnostics?.bendingSuppressed, "deep bend should be bending-suppressed");
      return getTestDiagnostics(result);
    });

    test("squatting", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const result = engine.update({ landmarks: createSquattingTestLandmarks(), now: 1001 });
      assertTest(result.alertLevel === "none", "squatting should not alert");
      assertTest(!result.diagnostics?.candidateReady, "squatting should not be candidate-ready");
      return getTestDiagnostics(result);
    });

    test("kneeling", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const result = engine.update({ landmarks: createKneelingTestLandmarks(), now: 1001 });
      assertTest(result.alertLevel === "none", "kneeling should not alert");
      assertTest(!result.diagnostics?.candidateReady, "kneeling should not be candidate-ready");
      return getTestDiagnostics(result);
    });

    test("fast fall reaches peak score 9 and confirms after 5 seconds", () => {
      const engine = createPeakScoreTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const candidate = engine.update({ landmarks: lying, now: 201 });
      assertTest(candidate.alertLevel === "fall_candidate", "fast fall should create candidate");
      assertTest(candidate.event?.peakScore === 9, "fast fall peak score should be 9");

      const confirmed = engine.update({ landmarks: lying, now: 5201 });
      assertTest(confirmed.alertLevel === "confirmed_fall", "candidate should confirm after verify window");
      assertTest(confirmed.score === 9, "confirmation should use peak score");
      assertTest(confirmed.visualConfirmationReady, "visual confirmation should be ready");
      return getTestDiagnostics(candidate);
    });

    test("candidate score dropping after initial fall preserves peak", () => {
      const engine = createPeakScoreTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      engine.update({ landmarks: lying, now: 201 });

      const dropped = engine.update({ landmarks: lying, now: 1401 });
      assertTest(dropped.event?.peakScore === 9, "candidate peak score should remain 9");
      assertTest(dropped.event.currentScore < dropped.event.peakScore, "current score should drop below peak");
      assertTest(dropped.score === 9, "visual scoring should keep the peak score");
      assertTest(dropped.alertLevel === "none", "candidate should not confirm before verify window");
      return getTestDiagnostics(dropped);
    });

    test("pose disappearing briefly after strong candidate does not confirm or delete", () => {
      const engine = createPeakScoreTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      engine.update({ landmarks: lying, now: 201 });

      const uncertain = engine.update({ landmarks: null, now: 1201 });
      assertTest(uncertain.state === STATES.VERIFYING, "strong candidate should stay verifying");
      assertTest(uncertain.alertLevel === "none", "missing pose should not confirm");
      assertTest(uncertain.event?.peakScore === 9, "candidate should be retained during uncertainty");

      const recoveredPose = engine.update({ landmarks: lying, now: 1401 });
      assertTest(recoveredPose.state === STATES.VERIFYING, "candidate should resume verification");
      assertTest(recoveredPose.alertLevel === "none", "brief dropout should not skip verify time");
      return getTestDiagnostics(recoveredPose);
    });

    test("recovery to standing cancels candidate", () => {
      const engine = createPeakScoreTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      engine.update({ landmarks: lying, now: 201 });

      const recovered = engine.update({ landmarks: standing, now: 1001 });
      assertTest(recovered.state === STATES.RECOVERED, "standing return should recover candidate");
      assertTest(recovered.alertLevel === "recovered", "recovery should be reported");
      assertTest(recovered.event?.recoveredAt === 1001, "recovery event should include timestamp");
      return getTestDiagnostics(recovered);
    });

    test("controlled lying in bed zone stays safe", () => {
      const engine = createFallDetectionEngine({
        cameraWarmupMs: 0,
        minValidPoseFrames: 1,
      });
      engine.reset(0);
      engine.update({ landmarks: standing, now: 0, zones: createBedZone() });

      const result = engine.update({
        landmarks: lying,
        now: 3000,
        zones: createBedZone(),
      });
      assertTest(result.state === STATES.CONTROLLED_LYING, "bed-zone descent should be controlled lying");
      assertTest(result.alertLevel === "none", "bed-zone controlled lying should not alert");
      assertTest(!result.event, "bed-zone controlled lying should not create a candidate");
      return getTestDiagnostics(result);
    });

    test("bending where ankle landmarks remain near image bottom", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const result = engine.update({
        landmarks: createBendingTestLandmarks({ shoulderX: 0.27, shoulderY: 0.6, ankleY: 0.96 }),
        now: 801,
      });
      assertTest(result.sample?.boundingBox?.maxY >= 0.9, "test pose must keep ankle landmarks near bottom");
      assertTest(result.sample?.floorProximity === 0, "maxY >= 0.9 must not imply floor proximity");
      assertTest(!result.diagnostics?.candidateReady, "bottom-ankle bending should not be candidate-ready");
      return getTestDiagnostics(result);
    });

    test("bending must never produce FALL_CANDIDATE", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const bendFrames = [
        createBendingTestLandmarks(),
        createBendingTestLandmarks({ shoulderX: 0.29, shoulderY: 0.5, ankleY: 0.94 }),
        createBendingTestLandmarks({ shoulderX: 0.27, shoulderY: 0.6, ankleY: 0.96 }),
      ];
      const outputs = bendFrames.map((landmarks, index) =>
        engine.update({ landmarks, now: 801 + index * 500 }),
      );
      outputs.forEach((result) => {
        assertTest(result.state !== STATES.FALL_CANDIDATE, "bending produced FALL_CANDIDATE");
        assertTest(result.alertLevel !== "fall_candidate", "bending produced fall_candidate alert");
        assertTest(!result.diagnostics?.candidateReady, "bending became candidate-ready");
      });
      return getTestDiagnostics(outputs[outputs.length - 1]);
    });

    test("fast fall must still produce FALL_CANDIDATE", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const result = engine.update({ landmarks: lying, now: 201 });
      assertTest(result.state === STATES.FALL_CANDIDATE, "fast fall should enter FALL_CANDIDATE");
      assertTest(result.alertLevel === "fall_candidate", "fast fall should produce fall_candidate alert");
      assertTest(result.diagnostics?.candidateReady, "fast fall should be candidate-ready");
      assertTest(result.config.fallCandidateScoreThreshold === 6, "candidate threshold changed");
      assertTest(result.config.confirmedFallScoreThreshold === 8, "confirmed threshold changed");
      return getTestDiagnostics(result);
    });

    test("slow collapse must still be detectable", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      engine.update({ landmarks: standing, now: 1 });
      const result = engine.update({
        landmarks: createSlowCollapseEndLandmarks(),
        now: 1501,
      });
      assertTest(result.state === STATES.FALL_CANDIDATE, "slow collapse should enter FALL_CANDIDATE");
      assertTest(result.alertLevel === "fall_candidate", "slow collapse should produce fall_candidate alert");
      assertTest(result.diagnostics?.candidateReady, "slow collapse should be candidate-ready");
      return getTestDiagnostics(result);
    });

    test("maxY >= 0.9 alone is not near floor", () => {
      const engine = createRegressionTestEngine();
      engine.reset(0);
      const result = engine.update({
        landmarks: createBendingTestLandmarks({ ankleY: 0.96 }),
        now: 1,
      });
      assertTest(result.sample?.boundingBox?.maxY >= 0.9, "test pose must have maxY >= 0.9");
      assertTest(result.sample?.hipCenterY < result.config.fallbackFloorHipY, "hip center should not be low");
      assertTest(result.sample?.bodyCenterY < result.config.fallbackFloorBodyY, "body center should not be low");
      assertTest(result.sample?.floorProximity === 0, "maxY alone must not trigger floor proximity");
      return getTestDiagnostics(result);
    });

    const failed = results.filter((result) => !result.passed);
    if (throwOnFailure && failed.length) {
      throw new Error(
        failed.map((result) => `${result.name}: ${result.error}`).join("; "),
      );
    }

    return {
      passed: failed.length === 0,
      results,
    };
  }

  const api = {
    createFallDetectionEngine,
    defaultConfig: DEFAULT_CONFIG,
    runDeterministicTests,
    reasons: REASONS,
    states: STATES,
  };

  root.TsunagariFallDetectionEngine = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
