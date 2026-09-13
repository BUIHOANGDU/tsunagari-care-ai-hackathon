(function () {
  const CAMERA_ID = "default_cam";
  const LOCATION = "living_room";
  const LOG_KEY = "tsunagari_fall_camera_log";
  const MAX_LOCAL_LOG_ITEMS = 20;
  const FALL_DETECTION_CONFIG =
    window.TsunagariFallDetectionEngine?.defaultConfig || {
      cameraWarmupMs: 8000,
      minLandmarkVisibility: 0.55,
      minRenderableLandmarks: 8,
      poseHistoryWindowMs: 4000,
      postFallVerifyMs: 5000,
      robotResponseTimeoutMs: 12000,
      alertCooldownMs: 90000,
    };
  const DETECTION_INTERVAL_MS = 200;
  const CONFIRMED_FALL_MS = FALL_DETECTION_CONFIG.postFallVerifyMs;
  const FALL_ALERT_COOLDOWN_MS = FALL_DETECTION_CONFIG.alertCooldownMs;
  const FALL_EMERGENCY_COOLDOWN_MS = FALL_DETECTION_CONFIG.alertCooldownMs;
  const MIN_VALID_LANDMARKS =
    FALL_DETECTION_CONFIG.minRenderableLandmarks || 8;
  const MIN_LANDMARK_VISIBILITY =
    FALL_DETECTION_CONFIG.minLandmarkVisibility || 0.55;
  const CHAMI_EMERGENCY_TARGET = "chami_001";
  const CHAMI_EMERGENCY_ACTION = "emergency_check";
  const CHAMI_EMERGENCY_TEXT =
    "Camera phát hiện nguy cơ té ngã. Chami kiểm tra tình trạng người dùng.";
  const MEDIAPIPE_MODULE_URL =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";
  const MEDIAPIPE_WASM_ROOT =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
  const POSE_MODEL_URL =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
  const POSE_CONNECTIONS = [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [27, 29],
    [29, 31],
    [24, 26],
    [26, 28],
    [28, 30],
    [30, 32],
  ];
  const FALL_STAGE_LABELS = {
    INITIALIZING: "Calibrating",
    NO_PERSON: "No Person",
    POSE_UNCERTAIN: "Pose Uncertain",
    NORMAL: "Normal",
    BENDING: "Bending",
    SITTING: "Sitting",
    CONTROLLED_DESCENT: "Controlled Descent",
    CONTROLLED_LYING: "Controlled Lying",
    SLEEPING: "Safe Resting",
    FALL_CANDIDATE: "Fall Candidate",
    VERIFYING: "Verifying",
    CONFIRMED_FALL: "Confirmed Fall",
    RECOVERING: "Recovering",
    RECOVERED: "Recovered",
    COOLDOWN: "Cooldown",
    normal: "Normal",
    suspected_fall: "Suspected Fall",
    confirmed_fall: "Confirmed Fall",
    chami_check_sent: "Chami Check Sent",
    cooldown: "Cooldown",
  };
  const FALL_STAGE_TONES = {
    INITIALIZING: "accent",
    NO_PERSON: "normal",
    POSE_UNCERTAIN: "warning",
    NORMAL: "success",
    BENDING: "accent",
    SITTING: "success",
    CONTROLLED_DESCENT: "accent",
    CONTROLLED_LYING: "success",
    SLEEPING: "success",
    FALL_CANDIDATE: "warning",
    VERIFYING: "warning",
    CONFIRMED_FALL: "danger",
    RECOVERING: "accent",
    RECOVERED: "success",
    COOLDOWN: "accent",
    normal: "success",
    suspected_fall: "warning",
    confirmed_fall: "danger",
    chami_check_sent: "accent",
    cooldown: "accent",
  };

  const video = document.getElementById("camera-video");
  const canvas = document.getElementById("camera-overlay");
  const emptyState = document.getElementById("empty-camera-state");
  const startButton = document.getElementById("start-camera");
  const stopButton = document.getElementById("stop-camera");
  const testFallAlertButton = document.getElementById("test-fall-alert");
  const resetFallStateButton = document.getElementById("reset-fall-state");
  const clearLogButton = document.getElementById("clear-log");
  const configureZonesButton = document.getElementById("configure-zones");
  const clearZonesButton = document.getElementById("clear-zones");
  const zoneToolbar = document.getElementById("zone-toolbar");
  const zoneTypeSelect = document.getElementById("zone-type");
  const saveZoneButton = document.getElementById("save-zone");
  const cancelZoneButton = document.getElementById("cancel-zone");
  const logList = document.getElementById("local-log");
  const fallCommandStatus = document.getElementById("fall-command-status");
  const cameraStatus = document.getElementById("camera-status");
  const cameraStatusPill = document.getElementById("camera-status-pill");
  const personStatus = document.getElementById("person-status");
  const postureStatus = document.getElementById("posture-status");
  const detectionStage = document.getElementById("detection-stage");
  const fallStatus = document.getElementById("fall-status");
  const lyingDurationStatus = document.getElementById("lying-duration");
  const fallConfidenceStatus = document.getElementById("fall-confidence");
  const warmupStatus = document.getElementById("warmup-status");
  const activeZoneStatus = document.getElementById("active-zone");
  const safeZoneStatus = document.getElementById("safe-zone-status");
  const cooldownStatus = document.getElementById("cooldown-status");
  const lastChamiCommandStatus = document.getElementById("last-chami-command");

  let stream = null;
  let firestoreDb = null;
  let firestoreInitAttempted = false;
  let poseLandmarker = null;
  let poseLoadPromise = null;
  let detectionAnimationId = null;
  let cooldownAnimationId = null;
  let lastDetectionAt = 0;
  let lyingStartAt = null;
  let fallEventActive = false;
  let currentFallAlertId = null;
  let fallAlertCreatePending = false;
  let confirmedUpdateSent = false;
  let confirmedUpdatePending = false;
  let nextFallEventAllowedAt = 0;
  let fallEventGeneration = 0;
  let mediaPipeRuntimeErrorLogged = false;
  let lastFallEmergencyCommandAt = 0;
  let fallEmergencyCommandPending = false;
  let currentFallEventConfirmed = false;
  let chamiCheckSentForCurrentEvent = false;
  let fallExitStartedAt = null;
  let lastLyingDurationLoggedAt = 0;
  let lastPersonDetected = false;
  let suspectedFallLogged = false;
  let currentFallStage = "normal";
  let currentChamiCommandId = null;
  let currentFallFlowId = null;
  let fallConfirmedCareEventWritten = false;
  let robotVerificationStartedAt = null;
  let robotVerificationUnavailable = false;
  let latestFallDetectionResult = null;
  let currentFallScore = 0;
  let zoneEditing = false;
  let zoneDragStart = null;
  let zoneDraftRect = null;
  let fallCameraPublisher = null;
  const fallCameraPublisherUnsubscribes = [];
  const fallCameraPublisherErrorCounts = new Map();
  const zoneManager = window.TsunagariFallZoneManager?.createZoneManager
    ? window.TsunagariFallZoneManager.createZoneManager()
    : null;
  const fallDetectionEngine =
    window.TsunagariFallDetectionEngine?.createFallDetectionEngine
      ? window.TsunagariFallDetectionEngine.createFallDetectionEngine()
      : null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getFirebaseConfig() {
    if (window.firebaseConfig) return window.firebaseConfig;

    try {
      if (typeof firebaseConfig !== "undefined") return firebaseConfig;
    } catch (error) {
      return null;
    }

    return null;
  }

  function initFirestore() {
    if (firestoreInitAttempted) return firestoreDb;
    firestoreInitAttempted = true;

    const config = getFirebaseConfig();

    if (!window.firebase || typeof firebase.initializeApp !== "function") {
      console.warn("FallCamera: Firebase SDK is not loaded.");
      return null;
    }

    if (!config) {
      console.warn("FallCamera: Firebase config is not available.");
      return null;
    }

    if (typeof firebase.firestore !== "function") {
      console.warn("FallCamera: Firestore SDK is not loaded.");
      return null;
    }

    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(config);
      }

      firestoreDb = firebase.firestore();
      console.log("FallCamera: Firestore initialized.");
      return firestoreDb;
    } catch (error) {
      console.warn("FallCamera: Firestore initialization failed.", error);
      return null;
    }
  }

  function getServerTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function getFirestoreOrThrow() {
    const db = initFirestore();

    if (!db) {
      throw new Error("Firebase Firestore is not configured");
    }

    return db;
  }

  function getLogs() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    } catch (error) {
      return [];
    }
  }

  function saveLogs(logs) {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  }

  function renderLogs() {
    const logs = getLogs();
    logList.innerHTML = "";

    if (logs.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "empty-log";
      emptyItem.textContent = "No local events";
      logList.appendChild(emptyItem);
      return;
    }

    logs.forEach((entry) => {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      const time = document.createElement("time");

      title.textContent = entry.message;
      time.dateTime = entry.timestamp;
      time.textContent = new Date(entry.timestamp).toLocaleString();

      item.appendChild(title);
      item.appendChild(time);
      logList.appendChild(item);
    });
  }

  function addLog(message) {
    const logs = getLogs();
    logs.unshift({
      cameraId: CAMERA_ID,
      location: LOCATION,
      message,
      timestamp: new Date().toISOString(),
    });
    saveLogs(logs.slice(0, MAX_LOCAL_LOG_ITEMS));
    renderLogs();
  }

  function setFallCommandStatus(message = "", tone = "") {
    if (!fallCommandStatus) return;

    fallCommandStatus.textContent = message;

    if (tone) {
      fallCommandStatus.dataset.tone = tone;
    } else {
      delete fallCommandStatus.dataset.tone;
    }
  }

  function logCameraEvent(message, level = "info", error = null) {
    addLog(message);

    if (level === "error") {
      console.error("FallCamera:", message, error || "");
      return;
    }

    if (level === "warn") {
      console.warn("FallCamera:", message, error || "");
      return;
    }

    console.log("FallCamera:", message);
  }

  function hasLiveFallCameraStream() {
    return Boolean(
      stream &&
        typeof stream.getVideoTracks === "function" &&
        stream.getVideoTracks().some((track) => track.readyState === "live"),
    );
  }

  function shouldLogPublisherError(reason) {
    const currentCount = fallCameraPublisherErrorCounts.get(reason) || 0;
    const nextCount = currentCount + 1;
    fallCameraPublisherErrorCounts.set(reason, nextCount);
    return nextCount === 1 || nextCount % 6 === 0;
  }

  async function ensureFallCameraPublisher() {
    if (fallCameraPublisher) return fallCameraPublisher;

    if (!window.TsunagariCameraSignaling) {
      logCameraEvent("Remote viewing signaling module is not loaded", "warn");
      return null;
    }

    if (!hasLiveFallCameraStream()) {
      logCameraEvent("Remote viewing skipped: camera stream is not live", "warn");
      return null;
    }

    fallCameraPublisher =
      window.TsunagariCameraSignaling.createCameraHostController({
        hostDeviceId: "camera_home_001",
        unsubscribes: fallCameraPublisherUnsubscribes,
        onViewerCount: (count) => {
          logCameraEvent(`Remote viewers: ${count}`);
        },
        onOfferCreated: (sessionId) => {
          logCameraEvent(`Remote viewing offer created: ${sessionId}`);
        },
        onPeerState: (sessionId, state) => {
          logCameraEvent(`Remote viewer ${sessionId}: ${state}`);
        },
        onError: (reason, error) => {
          if (!shouldLogPublisherError(reason)) return;
          logCameraEvent(
            `Remote viewing signaling failed: ${reason}`,
            "warn",
            error,
          );
        },
      });

    const initialStatusWritten = await fallCameraPublisher.start(() => stream);
    if (!initialStatusWritten) {
      logCameraEvent(
        "Remote viewing publisher started with degraded host status",
        "warn",
      );
    }
    return fallCameraPublisher;
  }

  async function startFallCameraPublisher() {
    try {
      const publisher = await ensureFallCameraPublisher();
      if (!publisher || !stream) return;

      const statusWritten = await publisher.setStreamReady(true, {
        online: true,
        fallDetectionActive: true,
      });
      if (!statusWritten) {
        logCameraEvent("Remote viewing not ready: host status write failed", "warn");
        return;
      }
      logCameraEvent("Remote viewing ready from Fall Detection camera");
    } catch (error) {
      logCameraEvent("Remote viewing start failed", "warn", error);
    }
  }

  async function stopFallCameraPublisher({ offline = false } = {}) {
    if (!fallCameraPublisher) return;

    try {
      if (offline) {
        await fallCameraPublisher.shutdown();
        fallCameraPublisher = null;
        fallCameraPublisherUnsubscribes.splice(0).forEach((unsubscribe) => {
          unsubscribe();
        });
        return;
      }

      await fallCameraPublisher.stopPeers("closed");
      await fallCameraPublisher.setStreamReady(false, {
        online: true,
        fallDetectionActive: false,
      });
      logCameraEvent("Remote viewing stopped");
    } catch (error) {
      logCameraEvent("Remote viewing stop failed", "warn", error);
    }
  }

  function getFirebaseService() {
    if (window.FirebaseService) {
      return window.FirebaseService;
    }

    try {
      if (typeof FirebaseService !== "undefined") {
        return FirebaseService;
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function getRealtimeDatabaseOrThrow() {
    if (!window.firebase || typeof firebase.database !== "function") {
      throw new Error("firebase.database is not available");
    }

    const config = getFirebaseConfig();
    if ((!firebase.apps || !firebase.apps.length) && config) {
      firebase.initializeApp(config);
    }

    const realtimeDb = firebase.database();
    if (!realtimeDb) {
      throw new Error("Realtime Database is not initialized");
    }

    return realtimeDb;
  }

  function objectToArray(value) {
    if (!value || typeof value !== "object") {
      return [];
    }

    return Object.entries(value).map(([id, data]) => {
      if (data && typeof data === "object") {
        return { id, ...data };
      }

      return { id, value: data };
    });
  }

  function setStatusTone(element, tone = "") {
    if (!element) return;

    if (tone) {
      element.dataset.tone = tone;
    } else {
      delete element.dataset.tone;
    }
  }

  function getCooldownRemainingMs(now = Date.now()) {
    const alertCooldownRemaining = Math.max(0, nextFallEventAllowedAt - now);
    const emergencyCooldownRemaining = lastFallEmergencyCommandAt
      ? Math.max(
          0,
          lastFallEmergencyCommandAt + FALL_EMERGENCY_COOLDOWN_MS - now,
        )
      : 0;

    return Math.max(alertCooldownRemaining, emergencyCooldownRemaining);
  }

  function updateCooldownUI(now = Date.now()) {
    const remainingMs = getCooldownRemainingMs(now);

    if (remainingMs > 0) {
      cooldownStatus.textContent = `Cooldown: ${Math.ceil(remainingMs / 1000)}s`;
      setStatusTone(cooldownStatus, "warning");
      return remainingMs;
    }

    cooldownStatus.textContent = "Ready";
    setStatusTone(cooldownStatus, "success");
    return 0;
  }

  function updateLastChamiCommandStatus(message = "Waiting", tone = "") {
    if (!lastChamiCommandStatus) return;

    lastChamiCommandStatus.textContent = message;
    setStatusTone(lastChamiCommandStatus, tone);
  }

  function getCurrentLyingDuration(now = Date.now()) {
    return lyingStartAt ? Math.max(0, now - lyingStartAt) : 0;
  }

  function getVerificationDurationMs(now = Date.now()) {
    return currentFallFlowId && lyingStartAt ? Math.max(0, now - lyingStartAt) : 0;
  }

  function updateWarmupStatus(remainingMs = 0) {
    if (!warmupStatus) return;

    if (remainingMs > 0) {
      warmupStatus.textContent = `${Math.ceil(remainingMs / 1000)}s`;
      setStatusTone(warmupStatus, "accent");
      return;
    }

    warmupStatus.textContent = stream ? "Complete" : "Idle";
    setStatusTone(warmupStatus, stream ? "success" : "");
  }

  function updateZoneStatus(zone = "none") {
    if (activeZoneStatus) {
      activeZoneStatus.textContent =
        zone && zone !== "none" ? zone.replace("_", " ") : "None";
      setStatusTone(
        activeZoneStatus,
        zone === "bed" || zone === "sofa"
          ? "success"
          : zone === "floor" || zone === "fallback_floor"
            ? "warning"
            : "",
      );
    }

    if (!safeZoneStatus) return;

    const summary = zoneManager ? zoneManager.getSummary() : "Not configured";
    safeZoneStatus.textContent = summary;
    setStatusTone(
      safeZoneStatus,
      zoneManager && (zoneManager.hasZone("bed") || zoneManager.hasZone("sofa"))
        ? "success"
        : "warning",
    );
  }

  function updateFallProgressUI({
    hasPerson = lastPersonDetected,
    lyingDurationMs = getVerificationDurationMs(),
    stage = currentFallStage,
    now = Date.now(),
    score = currentFallScore,
    warmupRemainingMs = 0,
    verificationRemainingMs = 0,
    zone = latestFallDetectionResult?.zone || "none",
  } = {}) {
    const targetSeconds = (CONFIRMED_FALL_MS / 1000).toFixed(1);
    if (verificationRemainingMs > 0) {
      lyingDurationStatus.textContent = `${Math.ceil(verificationRemainingMs / 1000)}s left`;
    } else {
      const currentSeconds = hasPerson
        ? (lyingDurationMs / 1000).toFixed(1)
        : "0.0";
      lyingDurationStatus.textContent = `${currentSeconds}s / ${targetSeconds}s`;
    }
    fallConfidenceStatus.textContent = `${Math.max(0, score)} pts`;
    setStatusTone(
      fallConfidenceStatus,
      score >= FALL_DETECTION_CONFIG.confirmedFallScoreThreshold
        ? "danger"
        : score >= FALL_DETECTION_CONFIG.fallCandidateScoreThreshold
          ? "warning"
          : hasPerson
            ? "normal"
            : "",
    );
    updateWarmupStatus(warmupRemainingMs);
    updateZoneStatus(zone);
    updateCooldownUI(now);
  }

  function setFallStage(
    stage,
    {
      hasPerson = lastPersonDetected,
      lyingDurationMs = getCurrentLyingDuration(),
      fallStatusText = FALL_STAGE_LABELS[stage] || "Normal",
      now = Date.now(),
      score = currentFallScore,
      warmupRemainingMs = 0,
      verificationRemainingMs = 0,
      zone = latestFallDetectionResult?.zone || "none",
    } = {},
  ) {
    currentFallStage = stage;

    detectionStage.textContent = FALL_STAGE_LABELS[stage] || "Normal";
    fallStatus.textContent = fallStatusText;

    const tone = FALL_STAGE_TONES[stage] || "normal";
    setStatusTone(detectionStage, tone);
    setStatusTone(fallStatus, tone);

    updateFallProgressUI({
      hasPerson,
      lyingDurationMs,
      stage,
      now,
      score,
      warmupRemainingMs,
      verificationRemainingMs,
      zone,
    });
  }

  function refreshIdleStage(now = Date.now(), hasPerson = lastPersonDetected) {
    const remainingMs = getCooldownRemainingMs(now);

    if (
      remainingMs > 0 &&
      !lyingStartAt &&
      !fallEventActive &&
      !currentFallEventConfirmed &&
      !chamiCheckSentForCurrentEvent
    ) {
      if (currentFallStage !== "COOLDOWN") {
        logCameraEvent("FallCamera: fall emergency cooldown active");
      }
      setFallStage("COOLDOWN", {
        hasPerson,
        lyingDurationMs: 0,
        fallStatusText: "Cooldown",
        now,
      });
      return;
    }

    setFallStage("NORMAL", {
      hasPerson,
      lyingDurationMs: 0,
      fallStatusText: "Normal",
      now,
    });
  }

  async function hasPendingChamiEmergencyCheckCommand() {
    const firebaseService = getFirebaseService();
    let commands = [];

    if (firebaseService && typeof firebaseService.listCommands === "function") {
      logCameraEvent("Using FirebaseService wrapper for Chami emergency command");
      commands = await firebaseService.listCommands();
    } else {
      logCameraEvent("Using firebase.database fallback for Chami emergency command");
      const realtimeDb = getRealtimeDatabaseOrThrow();
      const snapshot = await realtimeDb.ref("commands").once("value");
      commands = objectToArray(snapshot.val());
    }

    return commands.some((command) => {
      if (!command || typeof command !== "object") return false;

      return (
        command.target === CHAMI_EMERGENCY_TARGET &&
        command.action === CHAMI_EMERGENCY_ACTION &&
        command.status === "pending"
      );
    });
  }

  async function createChamiEmergencyCheckCommand() {
    const firebaseService = getFirebaseService();

    if (
      firebaseService &&
      typeof firebaseService.createRobotActionCommand === "function"
    ) {
      logCameraEvent("Using FirebaseService wrapper for Chami emergency command");
      return firebaseService.createRobotActionCommand(
        CHAMI_EMERGENCY_TARGET,
        CHAMI_EMERGENCY_ACTION,
        CHAMI_EMERGENCY_TEXT,
        { source: "fall_camera" },
      );
    }

    logCameraEvent("Using firebase.database fallback for Chami emergency command");
    const realtimeDb = getRealtimeDatabaseOrThrow();
    const ref = realtimeDb.ref("commands").push();
    const payload = {
      source: "fall_camera",
      target: CHAMI_EMERGENCY_TARGET,
      type: "robot_action",
      action: CHAMI_EMERGENCY_ACTION,
      text: CHAMI_EMERGENCY_TEXT,
      status: "pending",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    };
    const data = {
      id: ref.key,
      ...payload,
    };

    await ref.set(data);
    return data;
  }

  function getOrCreateFallFlowId() {
    if (!currentFallFlowId) {
      currentFallFlowId = `fall_${Date.now()}`;
    }

    return currentFallFlowId;
  }

  async function writeFallResponseCareEvent(type, status, message, detail, extra = {}) {
    const payload = {
      flow: "fall_response",
      flowId: getOrCreateFallFlowId(),
      source: "fall_camera",
      type,
      status,
      message,
      detail,
      relatedCommandId: extra.relatedCommandId || "",
      relatedAlertId: "",
      cameraId: CAMERA_ID,
      location: LOCATION,
    };
    if (typeof extra.score === "number") payload.score = extra.score;
    if (Array.isArray(extra.reasons)) payload.reasons = extra.reasons;
    if (extra.zone) payload.zone = extra.zone;

    try {
      const firebaseService = getFirebaseService();
      if (
        firebaseService &&
        typeof firebaseService.createCareEvent === "function"
      ) {
        await firebaseService.createCareEvent(payload);
      } else {
        const realtimeDb = getRealtimeDatabaseOrThrow();
        const ref = realtimeDb.ref("care_events").push();
        await ref.set({
          id: ref.key,
          ...payload,
          createdAt: firebase.database.ServerValue.TIMESTAMP,
        });
      }

      logCameraEvent(`care event written: ${type}`);
      return true;
    } catch (error) {
      logCameraEvent(`care event write failed: ${type}`, "warn", error);
      return false;
    }
  }

  async function handleFallConfirmedLegacy() {
    logCameraEvent("Fall confirmed by camera");

    if (fallEmergencyCommandPending) {
      return;
    }

    fallEmergencyCommandPending = true;
    getOrCreateFallFlowId();
    if (!fallConfirmedCareEventWritten) {
      fallConfirmedCareEventWritten = true;
      writeFallResponseCareEvent(
        "fall_confirmed",
        "danger",
        "Camera phát hiện nguy cơ té ngã",
        "Fall Camera xác nhận tư thế nằm/ngã",
      );
    }
    setFallStage("confirmed_fall", {
      hasPerson: lastPersonDetected,
      lyingDurationMs: getCurrentLyingDuration(),
      fallStatusText: "Confirmed Fall",
    });

    try {
      if (await hasPendingChamiEmergencyCheckCommand()) {
        chamiCheckSentForCurrentEvent = true;
        logCameraEvent("Emergency_check command already pending for Chami");
        setFallStage("chami_check_sent", {
          hasPerson: lastPersonDetected,
          lyingDurationMs: getCurrentLyingDuration(),
          fallStatusText: "Chami Check Sent",
        });
        updateLastChamiCommandStatus("Pending command already exists", "warning");
        setFallCommandStatus(
          "Chami đã có yêu cầu kiểm tra đang chờ xử lý",
          "warning",
        );
        return;
      }

      if (
        lastFallEmergencyCommandAt &&
        Date.now() - lastFallEmergencyCommandAt < FALL_EMERGENCY_COOLDOWN_MS
      ) {
        logCameraEvent("Fall emergency_check skipped by cooldown");
        logCameraEvent("FallCamera: fall emergency cooldown active");
        setFallStage("cooldown", {
          hasPerson: lastPersonDetected,
          lyingDurationMs: getCurrentLyingDuration(),
          fallStatusText: "Cooldown",
        });
        updateLastChamiCommandStatus("Cooldown active", "warning");
        setFallCommandStatus(
          "Đã phát hiện ngã, đang trong thời gian chờ chống spam",
          "warning",
        );
        return;
      }

      logCameraEvent("Creating Chami emergency_check command from fall camera");
      const command = await createChamiEmergencyCheckCommand();
      lastFallEmergencyCommandAt = Date.now();
      chamiCheckSentForCurrentEvent = true;
      currentChamiCommandId = command && command.id ? command.id : null;
      logCameraEvent("Created Chami emergency_check command from fall camera");
      if (currentChamiCommandId) {
        addLog(`Chami emergency_check command id: ${currentChamiCommandId}`);
      }
      writeFallResponseCareEvent(
        "chami_command_sent",
        "active",
        "Đã yêu cầu Chami kiểm tra người dùng",
        "Command emergency_check đã được gửi tới Chami",
        { relatedCommandId: currentChamiCommandId || "" },
      );
      setFallStage("chami_check_sent", {
        hasPerson: lastPersonDetected,
        lyingDurationMs: getCurrentLyingDuration(),
        fallStatusText: "Chami Check Sent",
      });
      updateLastChamiCommandStatus(
        currentChamiCommandId
          ? `Created: ${currentChamiCommandId}`
          : "Created successfully",
        "success",
      );
      setFallCommandStatus("Đã yêu cầu Chami kiểm tra người dùng", "success");
    } catch (error) {
      logCameraEvent(
        "Failed to create Chami emergency_check command from fall camera",
        "error",
        error,
      );
      updateLastChamiCommandStatus("Command error", "danger");
      setFallCommandStatus("Không thể gửi yêu cầu kiểm tra tới Chami", "danger");
    } finally {
      fallEmergencyCommandPending = false;
      updateCooldownUI();
    }
  }

  async function requestRobotFallVerification(detectionResult) {
    if (
      chamiCheckSentForCurrentEvent ||
      fallEmergencyCommandPending ||
      getCooldownRemainingMs() > 0
    ) {
      return;
    }

    fallEmergencyCommandPending = true;
    robotVerificationStartedAt = Date.now();
    getOrCreateFallFlowId();

    try {
      logCameraEvent("Creating Chami fall verification command");
      const command = await createChamiEmergencyCheckCommand();
      lastFallEmergencyCommandAt = Date.now();
      chamiCheckSentForCurrentEvent = true;
      currentChamiCommandId = command && command.id ? command.id : null;
      robotVerificationUnavailable = false;
      updateLastChamiCommandStatus(
        currentChamiCommandId
          ? `Verification: ${currentChamiCommandId}`
          : "Verification requested",
        "warning",
      );
      setFallCommandStatus("Chami verification requested", "warning");
      writeFallResponseCareEvent(
        "fall_verification_requested",
        "warning",
        "Camera is verifying a fall candidate",
        "Chami emergency_check command was requested before danger alert",
        {
          relatedCommandId: currentChamiCommandId || "",
          score: detectionResult?.score || 0,
          reasons: detectionResult?.reasons || [],
          zone: detectionResult?.zone || "none",
        },
      );
    } catch (error) {
      robotVerificationUnavailable = true;
      logCameraEvent("robot verification unavailable", "warn", error);
      updateLastChamiCommandStatus("Verification unavailable", "warning");
      setFallCommandStatus(
        "Robot verification unavailable; using visual verification fallback",
        "warning",
      );
    } finally {
      fallEmergencyCommandPending = false;
    }
  }

  function canDispatchConfirmedFall(detectionResult, now = Date.now()) {
    if (!detectionResult || detectionResult.alertLevel !== "confirmed_fall") {
      return false;
    }

    if (currentFallEventConfirmed || fallAlertCreatePending) return false;
    if (getCooldownRemainingMs(now) > 0 && !fallEventActive) return false;

    if (!chamiCheckSentForCurrentEvent || robotVerificationUnavailable) {
      return true;
    }

    return (
      robotVerificationStartedAt &&
      now - robotVerificationStartedAt >= FALL_DETECTION_CONFIG.robotResponseTimeoutMs
    );
  }

  async function handleFallConfirmed(detectionResult = null) {
    logCameraEvent("Fall confirmed by camera");

    getOrCreateFallFlowId();
    if (!fallConfirmedCareEventWritten) {
      fallConfirmedCareEventWritten = true;
      writeFallResponseCareEvent(
        "fall_confirmed",
        "danger",
        "Camera confirmed fall risk",
        "Visual verification stayed positive after recovery and safe-zone checks",
        {
          score: detectionResult?.score || currentFallScore,
          reasons: detectionResult?.reasons || [],
          zone: detectionResult?.zone || "none",
        },
      );
    }

    if (chamiCheckSentForCurrentEvent) {
      updateLastChamiCommandStatus(
        currentChamiCommandId
          ? `No response: ${currentChamiCommandId}`
          : "No robot response",
        "warning",
      );
      setFallCommandStatus(
        "Confirmed after visual verification and robot timeout",
        "danger",
      );
      return;
    }

    await requestRobotFallVerification(detectionResult);
  }

  function markCurrentFallAlertConfirmedIfNeeded() {
    if (
      !currentFallAlertId ||
      confirmedUpdateSent ||
      confirmedUpdatePending ||
      !currentFallEventConfirmed
    ) {
      return;
    }

    confirmedUpdateSent = true;
    confirmedUpdatePending = true;
    addLog(`Fall event confirmed: ${currentFallAlertId}`);

    updateFallAlertConfirmed(currentFallAlertId).finally(() => {
      confirmedUpdatePending = false;
    });
  }

  async function confirmFallFromCamera(now = Date.now(), detectionResult = null) {
    if (currentFallEventConfirmed) {
      return;
    }

    currentFallEventConfirmed = true;
    currentFallScore = detectionResult?.score || currentFallScore;
    setFallStage("CONFIRMED_FALL", {
      hasPerson: true,
      lyingDurationMs: getCurrentLyingDuration(now),
      fallStatusText: "Confirmed Fall",
      now,
    });
    logCameraEvent("FallCamera: confirmed fall threshold reached");
    logCameraEvent("FallCamera: real camera confirmed fall");
    fallAlertCreatePending = true;

    const alertId = await sendFallAlert(
      "confirmed",
      detectionResult || latestFallDetectionResult,
      getVerificationDurationMs(now),
      {
        eventId: detectionResult?.event?.eventId || currentFallFlowId,
        source: "fall_camera",
        verificationResponse: chamiCheckSentForCurrentEvent
          ? "no_response"
          : "robot_unavailable",
      },
    );

    fallAlertCreatePending = false;
    if (alertId) {
      currentFallAlertId = alertId;
      nextFallEventAllowedAt = Math.max(
        nextFallEventAllowedAt,
        now + FALL_ALERT_COOLDOWN_MS,
      );
    }

    handleFallConfirmed(detectionResult);
  }

  function setCameraOnline(isOnline) {
    cameraStatus.textContent = isOnline ? "Online" : "Offline";
    cameraStatusPill.textContent = isOnline ? "Online" : "Offline";
    cameraStatusPill.classList.toggle("online", isOnline);
    cameraStatusPill.classList.toggle("offline", !isOnline);
    emptyState.classList.toggle("hidden", isOnline);
    startButton.disabled = isOnline;
    stopButton.disabled = !isOnline;
  }

  async function syncCameraOnline() {
    const db = getFirestoreOrThrow();
    const timestamp = getServerTimestamp();

    await db.collection("cameras").doc(CAMERA_ID).set(
      {
        name: "Living Room Camera",
        location: LOCATION,
        status: "online",
        deviceType: "webcam",
        aiModel: "none_mvp",
        lastSeen: timestamp,
        updatedAt: timestamp,
      },
      { merge: true },
    );
  }

  async function syncCameraOffline() {
    const db = getFirestoreOrThrow();

    await db.collection("cameras").doc(CAMERA_ID).update({
      status: "offline",
      updatedAt: getServerTimestamp(),
    });
  }

  async function runCameraStatusSync(syncFn, successMessage) {
    try {
      await syncFn();
      addLog(successMessage);
      console.log("FallCamera:", successMessage);
    } catch (error) {
      const message = `Firestore sync failed: ${error.message}`;
      addLog(message);
      console.warn("FallCamera:", message, error);
    }
  }

  async function initPoseLandmarker() {
    if (poseLandmarker) return poseLandmarker;
    if (poseLoadPromise) return poseLoadPromise;

    postureStatus.textContent = "Loading MediaPipe Pose...";
    addLog("Loading MediaPipe Pose...");

    poseLoadPromise = (async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import(
          MEDIAPIPE_MODULE_URL
        );
        const vision = await FilesetResolver.forVisionTasks(
          MEDIAPIPE_WASM_ROOT,
        );

        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: POSE_MODEL_URL,
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: false,
        });

        postureStatus.textContent = "Unknown";
        addLog("MediaPipe Pose ready");
        console.log("FallCamera: MediaPipe Pose Landmarker ready.");
        return poseLandmarker;
      } catch (error) {
        poseLoadPromise = null;
        postureStatus.textContent = "MediaPipe error";
        addLog(`MediaPipe Pose load failed: ${error.message}`);
        console.error("FallCamera: MediaPipe Pose load failed.", error);
        throw error;
      }
    })();

    return poseLoadPromise;
  }

  function resizeOverlay() {
    const width = video.videoWidth || video.clientWidth;
    const height = video.videoHeight || video.clientHeight;

    if (!width || !height) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    drawOverlay();
  }

  function drawOverlay() {
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(255, 255, 255, 0.42)";
    context.lineWidth = 2;
    context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    drawZones(context);
  }

  function getZoneColor(type) {
    if (type === "bed") return "rgba(19, 138, 97, 0.72)";
    if (type === "sofa") return "rgba(36, 87, 197, 0.72)";
    return "rgba(201, 58, 58, 0.72)";
  }

  function drawZoneRect(context, zone, dashed = false) {
    if (!zone || !Array.isArray(zone.points) || zone.points.length < 4) return;

    const xs = zone.points.map((point) => point.x * canvas.width);
    const ys = zone.points.map((point) => point.y * canvas.height);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const color = getZoneColor(zone.type);

    context.save();
    context.strokeStyle = color;
    context.fillStyle = color.replace("0.72", "0.12");
    context.lineWidth = Math.max(2, canvas.width * 0.003);
    if (dashed) context.setLineDash([8, 6]);
    context.fillRect(minX, minY, maxX - minX, maxY - minY);
    context.strokeRect(minX, minY, maxX - minX, maxY - minY);
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.font = `${Math.max(12, canvas.width * 0.016)}px Inter, sans-serif`;
    context.fillText(zone.type.toUpperCase(), minX + 8, minY + 18);
    context.restore();
  }

  function drawZones(context) {
    if (zoneManager) {
      zoneManager.getZones().forEach((zone) => drawZoneRect(context, zone));
    }

    if (zoneDraftRect && zoneTypeSelect) {
      const points = window.TsunagariFallZoneManager?.rectToPoints(zoneDraftRect);
      if (points) {
        drawZoneRect(context, { type: zoneTypeSelect.value, points }, true);
      }
    }
  }

  function setZoneEditing(enabled) {
    zoneEditing = enabled;
    zoneDragStart = null;
    zoneDraftRect = null;
    canvas.classList.toggle("zone-editing", enabled);
    zoneToolbar?.classList.toggle("hidden", !enabled);
    if (saveZoneButton) saveZoneButton.disabled = true;
    drawOverlay();
  }

  function getNormalizedCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function handleZonePointerDown(event) {
    if (!zoneEditing) return;
    const point = getNormalizedCanvasPoint(event);
    if (!point) return;

    zoneDragStart = point;
    zoneDraftRect = {
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
    };
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleZonePointerMove(event) {
    if (!zoneEditing || !zoneDragStart || !zoneDraftRect) return;
    const point = getNormalizedCanvasPoint(event);
    if (!point) return;

    zoneDraftRect.endX = point.x;
    zoneDraftRect.endY = point.y;
    if (saveZoneButton) {
      const width = Math.abs(zoneDraftRect.endX - zoneDraftRect.startX);
      const height = Math.abs(zoneDraftRect.endY - zoneDraftRect.startY);
      saveZoneButton.disabled = width < 0.03 || height < 0.03;
    }
    drawOverlay();
    event.preventDefault();
  }

  function handleZonePointerUp(event) {
    if (!zoneEditing) return;
    canvas.releasePointerCapture?.(event.pointerId);
    zoneDragStart = null;
    event.preventDefault();
  }

  function saveCurrentZone() {
    if (!zoneManager || !zoneDraftRect || !zoneTypeSelect) return;

    zoneManager.addRectangle(zoneTypeSelect.value, zoneDraftRect);
    addLog(`Zone saved: ${zoneTypeSelect.value}`);
    setFallCommandStatus("Zone configuration saved locally", "success");
    updateZoneStatus(latestFallDetectionResult?.zone || "none");
    setZoneEditing(false);
  }

  function clearZoneConfiguration() {
    if (!zoneManager) return;

    zoneManager.clear();
    addLog("Zone configuration cleared");
    setFallCommandStatus("Zone configuration cleared", "warning");
    updateZoneStatus("none");
    drawOverlay();
  }

  function isValidLandmark(landmark) {
    if (!landmark) return false;
    if (landmark.x < 0 || landmark.x > 1 || landmark.y < 0 || landmark.y > 1) {
      return false;
    }

    return (landmark.visibility ?? 1) >= MIN_LANDMARK_VISIBILITY;
  }

  function getLandmarkPoint(landmark) {
    return {
      x: landmark.x * canvas.width,
      y: landmark.y * canvas.height,
    };
  }

  function calculatePosture(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      return {
        hasPerson: false,
        posture: "Unknown",
        confidence: 0,
        validLandmarks: [],
      };
    }

    const validLandmarks = landmarks.filter(isValidLandmark);

    if (validLandmarks.length < MIN_VALID_LANDMARKS) {
      return {
        hasPerson: false,
        posture: "Unknown",
        confidence: 0,
        validLandmarks,
      };
    }

    const points = validLandmarks.map(getLandmarkPoint);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bodyWidth = Math.max(0, maxX - minX);
    const bodyHeight = Math.max(0, maxY - minY);
    const bodyRatio = bodyHeight > 0 ? bodyWidth / bodyHeight : 0;
    const confidence =
      validLandmarks.reduce(
        (sum, landmark) => sum + (landmark.visibility ?? 0.8),
        0,
      ) / validLandmarks.length;

    let posture = "Unknown";
    if (bodyHeight > bodyWidth * 1.2) {
      posture = "Standing";
    } else if (bodyWidth > bodyHeight * 1.3) {
      posture = "Lying";
    }

    return {
      hasPerson: true,
      posture,
      bodyWidth,
      bodyHeight,
      bodyRatio,
      confidence,
      validLandmarks,
      boundingBox: { minX, maxX, minY, maxY },
    };
  }

  function getEnginePostureLabel(posture) {
    const labels = {
      standing: "Standing",
      sitting: "Sitting",
      bending: "Bending",
      lying: "Lying",
      unknown: "Unknown",
    };

    return labels[posture] || null;
  }

  function updatePoseStatus(postureInfo, detectionResult = null) {
    if (!postureInfo.hasPerson) {
      lastPersonDetected = false;
      personStatus.textContent = "No person";
      postureStatus.textContent = "Unknown";
      return;
    }

    if (!lastPersonDetected) {
      logCameraEvent("FallCamera: person detected");
    }

    lastPersonDetected = true;
    personStatus.textContent = "Person detected";
    postureStatus.textContent =
      getEnginePostureLabel(detectionResult?.posture) || postureInfo.posture;
  }

  function handleFallDetection(detectionResult, postureInfo, now = Date.now()) {
    updateCooldownUI(now);

    if (!fallDetectionEngine || !detectionResult) {
      refreshIdleStage(now, postureInfo.hasPerson);
      return;
    }

    latestFallDetectionResult = detectionResult;
    currentFallScore = detectionResult.score || 0;

    if (detectionResult.transition) {
      logCameraEvent(
        `State transition ${detectionResult.transition.from} -> ${detectionResult.transition.to}`,
      );
    }

    if (
      detectionResult.alertLevel === "fall_candidate" &&
      !fallEventActive &&
      now >= nextFallEventAllowedAt
    ) {
      fallEventActive = true;
      lyingStartAt = detectionResult.event?.candidateStartedAt || now;
      currentFallFlowId = detectionResult.event?.eventId || getOrCreateFallFlowId();
      suspectedFallLogged = true;
      addLog(
        `Fall candidate score=${detectionResult.score} reasons=${detectionResult.reasons.join(",")} zone=${detectionResult.zone}`,
      );
    }

    if (
      (detectionResult.state === "FALL_CANDIDATE" ||
        detectionResult.state === "VERIFYING") &&
      fallEventActive &&
      !chamiCheckSentForCurrentEvent &&
      !robotVerificationUnavailable
    ) {
      requestRobotFallVerification(detectionResult);
    }

    if (detectionResult.alertLevel === "recovered") {
      addLog("Fall candidate recovered");
      setFallCommandStatus("Candidate recovered; no danger alert sent", "success");
      resetFallEvent(now, true, "recovery");
      setFallStage("RECOVERED", {
        hasPerson: postureInfo.hasPerson,
        lyingDurationMs: 0,
        fallStatusText: "Recovered",
        now,
        score: 0,
        zone: detectionResult.zone,
      });
      return;
    }

    if (canDispatchConfirmedFall(detectionResult, now)) {
      confirmFallFromCamera(now, detectionResult);
      return;
    }

    const stage =
      currentFallEventConfirmed && detectionResult.state !== "COOLDOWN"
        ? "CONFIRMED_FALL"
        : detectionResult.state;
    const verificationRemainingMs =
      chamiCheckSentForCurrentEvent && robotVerificationStartedAt
        ? Math.max(
            detectionResult.verificationRemainingMs || 0,
            FALL_DETECTION_CONFIG.robotResponseTimeoutMs -
              (now - robotVerificationStartedAt),
          )
        : detectionResult.verificationRemainingMs || 0;

    setFallStage(stage, {
      hasPerson: postureInfo.hasPerson,
      lyingDurationMs: getVerificationDurationMs(now),
      fallStatusText: FALL_STAGE_LABELS[stage] || stage,
      now,
      score: detectionResult.score,
      warmupRemainingMs: detectionResult.warmupRemainingMs || 0,
      verificationRemainingMs,
      zone: detectionResult.zone,
    });
  }

  async function sendFallAlert(status, postureInfo, lyingDuration, options = {}) {
    const confidence = Math.max(
      0,
      Math.min(
        1,
        Number(
          (
            postureInfo.confidence ||
            postureInfo.sample?.poseConfidence ||
            0.7
          ).toFixed(2),
        ),
      ),
    );
    const ratio = Number(
      (postureInfo.bodyRatio ||
        postureInfo.sample?.bodyAspectRatio ||
        0).toFixed(2),
    );
    const seconds = Math.round(lyingDuration / 1000);
    const score = postureInfo.score || 0;
    const reasons = Array.isArray(postureInfo.reasons) ? postureInfo.reasons : [];
    const zone = postureInfo.zone || "none";

    try {
      const db = getFirestoreOrThrow();
      const docRef = await db.collection("fallAlerts").add({
        cameraId: CAMERA_ID,
        location: LOCATION,
        type: "fall_detected",
        status,
        severity: status === "confirmed" ? "danger" : "warning",
        confidence,
        score,
        reasons,
        zone,
        source: "webcam",
        eventId: options.eventId || postureInfo.event?.eventId || "",
        alertSent: status === "confirmed",
        isTest: Boolean(options.isTest),
        sourceDetail: options.source || "fall_camera",
        aiModel: "mediapipe_pose_landmarker",
        createdAt: getServerTimestamp(),
        confirmedAt: status === "confirmed" ? getServerTimestamp() : null,
        resolvedAt: null,
        verification: {
          robotAsked: Boolean(chamiCheckSentForCurrentEvent),
          response: options.verificationResponse || "visual_only",
        },
        note:
          status === "confirmed"
            ? `Verified fall event after ${seconds}s, score ${score}, body ratio ${ratio}`
            : `Fall candidate score ${score}, body ratio ${ratio}`,
      });
      const message = `Auto fall alert sent (${status}): ${docRef.id}`;
      addLog(message);
      console.log("FallCamera:", message);
      return docRef.id;
    } catch (error) {
      const message = `Auto fall alert failed (${status}): ${error.message}`;
      addLog(message);
      console.warn("FallCamera:", message, error);
      return null;
    }
  }

  async function updateFallAlertConfirmed(alertId) {
    try {
      const db = getFirestoreOrThrow();
      const timestamp = getServerTimestamp();

      await db.collection("fallAlerts").doc(alertId).update({
        status: "confirmed",
        confirmedAt: timestamp,
        updatedAt: timestamp,
      });

      const message = "Fall alert updated to confirmed";
      addLog(message);
      console.log("FallCamera:", message);
      return true;
    } catch (error) {
      const message = `Fall alert confirm failed: ${error.message}`;
      addLog(message);
      console.warn("FallCamera:", message, error);
      return false;
    }
  }

  function resetFallEvent(now = Date.now(), startCooldown = false, reason = "") {
    const hadFallSequence =
      !!lyingStartAt ||
      fallEventActive ||
      !!currentFallAlertId ||
      fallAlertCreatePending ||
      currentFallEventConfirmed ||
      chamiCheckSentForCurrentEvent;

    lyingStartAt = null;
    fallEventActive = false;
    currentFallAlertId = null;
    fallAlertCreatePending = false;
    currentFallEventConfirmed = false;
    chamiCheckSentForCurrentEvent = false;
    currentFallFlowId = null;
    fallConfirmedCareEventWritten = false;
    robotVerificationStartedAt = null;
    robotVerificationUnavailable = false;
    latestFallDetectionResult = null;
    currentFallScore = 0;
    fallExitStartedAt = null;
    confirmedUpdateSent = false;
    confirmedUpdatePending = false;
    suspectedFallLogged = false;
    lastLyingDurationLoggedAt = 0;
    fallEventGeneration += 1;

    if (startCooldown && hadFallSequence) {
      nextFallEventAllowedAt = Math.max(
        nextFallEventAllowedAt,
        now + FALL_ALERT_COOLDOWN_MS,
      );
      logCameraEvent("FallCamera: fall event reset after recovery");
      if (reason === "recovery") {
        setFallCommandStatus("Đang chờ cooldown trước khi detect lại", "warning");
      }
    }

    refreshIdleStage(now, lastPersonDetected);
    updateFallProgressUI({
      hasPerson: lastPersonDetected,
      lyingDurationMs: 0,
      stage: currentFallStage,
      now,
      score: 0,
    });
  }

  function resetTransientFallDetection(now = Date.now()) {
    resetFallEvent(now, false, "camera_start_reset");
    if (fallDetectionEngine) {
      fallDetectionEngine.reset(now);
    }
    lastPersonDetected = false;
    fallExitStartedAt = null;
    lastDetectionAt = 0;
    currentFallScore = 0;
    latestFallDetectionResult = null;
    robotVerificationStartedAt = null;
    robotVerificationUnavailable = false;
    setFallStage("INITIALIZING", {
      hasPerson: false,
      lyingDurationMs: 0,
      fallStatusText: "Calibrating",
      now,
      score: 0,
      warmupRemainingMs: FALL_DETECTION_CONFIG.cameraWarmupMs,
    });
  }

  function drawPose(landmarks, postureInfo) {
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    drawOverlay();

    if (!landmarks || !postureInfo.hasPerson) return;

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    context.strokeStyle =
      postureInfo.posture === "Lying"
        ? "rgba(201, 58, 58, 0.92)"
        : "rgba(19, 138, 97, 0.9)";
    context.lineWidth = Math.max(3, canvas.width * 0.004);

    POSE_CONNECTIONS.forEach(([startIndex, endIndex]) => {
      const start = landmarks[startIndex];
      const end = landmarks[endIndex];

      if (!isValidLandmark(start) || !isValidLandmark(end)) return;

      const startPoint = getLandmarkPoint(start);
      const endPoint = getLandmarkPoint(end);

      context.beginPath();
      context.moveTo(startPoint.x, startPoint.y);
      context.lineTo(endPoint.x, endPoint.y);
      context.stroke();
    });

    context.fillStyle = "rgba(255, 255, 255, 0.95)";
    landmarks.forEach((landmark) => {
      if (!isValidLandmark(landmark)) return;

      const point = getLandmarkPoint(landmark);
      context.beginPath();
      context.arc(point.x, point.y, Math.max(3, canvas.width * 0.004), 0, 7);
      context.fill();
    });

    if (postureInfo.boundingBox) {
      const { minX, minY, maxX, maxY } = postureInfo.boundingBox;
      context.strokeStyle = "rgba(255, 255, 255, 0.72)";
      context.lineWidth = 2;
      context.strokeRect(minX, minY, maxX - minX, maxY - minY);
    }

    context.restore();
  }

  function startCooldownTicker() {
    if (cooldownAnimationId) return;

    const tick = () => {
      updateCooldownUI();
      if (!stream && getCooldownRemainingMs() <= 0) {
        cooldownAnimationId = null;
        refreshIdleStage(Date.now(), false);
        return;
      }

      cooldownAnimationId = window.setTimeout(tick, 250);
    };

    tick();
  }

  function stopCooldownTicker() {
    if (!cooldownAnimationId) return;

    window.clearTimeout(cooldownAnimationId);
    cooldownAnimationId = null;
  }

  function startPoseDetection() {
    if (detectionAnimationId || !poseLandmarker || !stream) return;

    lastDetectionAt = 0;
    mediaPipeRuntimeErrorLogged = false;
    startCooldownTicker();
    detectPoseLoop();
  }

  function stopPoseDetection() {
    if (detectionAnimationId) {
      cancelAnimationFrame(detectionAnimationId);
      detectionAnimationId = null;
    }

    lastDetectionAt = 0;
    fallDetectionEngine?.reset(Date.now());
    resetFallEvent(Date.now(), false, "stopped");
  }

  function detectPoseLoop(timestamp = performance.now()) {
    if (!stream || !poseLandmarker) {
      detectionAnimationId = null;
      return;
    }

    detectionAnimationId = requestAnimationFrame(detectPoseLoop);

    if (timestamp - lastDetectionAt < DETECTION_INTERVAL_MS) return;
    lastDetectionAt = timestamp;

    if (video.readyState < 2) return;

    try {
      resizeOverlay();

      const result = poseLandmarker.detectForVideo(video, timestamp);
      const landmarks = result.landmarks?.[0] || null;
      const postureInfo = calculatePosture(landmarks);
      const now = Date.now();
      const detectionResult = fallDetectionEngine
        ? fallDetectionEngine.update({
            landmarks,
            now,
            zones: zoneManager ? zoneManager.getZones() : [],
          })
        : null;

      updatePoseStatus(postureInfo, detectionResult);
      drawPose(landmarks, postureInfo);
      handleFallDetection(detectionResult, postureInfo, now);
    } catch (error) {
      if (!mediaPipeRuntimeErrorLogged) {
        mediaPipeRuntimeErrorLogged = true;
        postureStatus.textContent = "MediaPipe error";
        addLog(`MediaPipe detection failed: ${error.message}`);
        console.error("FallCamera: MediaPipe detection failed.", error);
      }
    }
  }

  async function startCamera() {
    if (stream) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      addLog("Camera permission denied");
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      video.srcObject = stream;
      await video.play();
      resetTransientFallDetection(Date.now());
      setCameraOnline(true);
      personStatus.textContent = "No person";
      postureStatus.textContent = poseLandmarker
        ? "Unknown"
        : "Loading MediaPipe Pose...";
      setFallCommandStatus("");
      updateLastChamiCommandStatus(
        currentChamiCommandId ? `Last: ${currentChamiCommandId}` : "Waiting",
        currentChamiCommandId ? "success" : "",
      );
      addLog("Camera started");
      runCameraStatusSync(syncCameraOnline, "Firestore camera status: online");
      startFallCameraPublisher();
      resizeOverlay();

      initPoseLandmarker()
        .then(() => {
          if (stream) startPoseDetection();
        })
        .catch(() => {});
    } catch (error) {
      stream = null;
      video.srcObject = null;
      setCameraOnline(false);
      addLog("Camera permission denied");
    }
  }

  async function stopCamera({ offline = false } = {}) {
    if (!stream) return;

    await stopFallCameraPublisher({ offline });
    stopPoseDetection();
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    setCameraOnline(false);
    personStatus.textContent = "No person";
    postureStatus.textContent = "Unknown";
    lastPersonDetected = false;
    refreshIdleStage(Date.now(), false);
    updateWarmupStatus(0);
    setFallCommandStatus("");
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    drawOverlay();
    addLog("Camera stopped");
    runCameraStatusSync(syncCameraOffline, "Firestore camera status: offline");
  }

  async function handleManualTestFallAlert() {
    testFallAlertButton.disabled = true;

    try {
      if (
        currentFallFlowId &&
        !fallEmergencyCommandPending &&
        getCooldownRemainingMs() === 0
      ) {
        resetFallEvent(Date.now(), false, "manual_demo_repeat");
      }
      logCameraEvent("Manual demo fall confirmed");
      currentFallEventConfirmed = true;
      const manualResult = {
        confidence: 1,
        score: FALL_DETECTION_CONFIG.confirmedFallScoreThreshold,
        reasons: ["MANUAL_TEST"],
        zone: "manual_test",
        event: { eventId: `manual_test_${Date.now()}` },
      };
      const alertId = await sendFallAlert("confirmed", manualResult, 0, {
        eventId: manualResult.event.eventId,
        source: "manual_test",
        isTest: true,
        verificationResponse: "manual_test",
      });
      if (alertId) currentFallAlertId = alertId;
      setFallStage("CONFIRMED_FALL", {
        hasPerson: true,
        lyingDurationMs: Math.max(CONFIRMED_FALL_MS, getCurrentLyingDuration()),
        fallStatusText: "Confirmed Fall",
        score: manualResult.score,
        zone: "manual_test",
      });
      await handleFallConfirmed(manualResult);
      resetFallEvent(Date.now(), true, "manual_test_complete");
    } catch (error) {
      logCameraEvent("Manual test fall flow failed", "error", error);
      setFallCommandStatus("Không thể gửi yêu cầu kiểm tra tới Chami", "danger");
    } finally {
      testFallAlertButton.disabled = false;
    }
  }

  function handleManualResetFallState() {
    logCameraEvent("FallCamera: manual fall state reset");
    resetFallEvent(Date.now(), false, "manual");
    setFallCommandStatus("");
    updateLastChamiCommandStatus(
      currentChamiCommandId ? `Last: ${currentChamiCommandId}` : "Waiting",
      currentChamiCommandId ? "success" : "",
    );
  }

  function clearLocalLog() {
    saveLogs([]);
    renderLogs();
  }

  startButton.addEventListener("click", startCamera);
  stopButton.addEventListener("click", () => stopCamera());
  testFallAlertButton.addEventListener("click", handleManualTestFallAlert);
  resetFallStateButton.addEventListener("click", handleManualResetFallState);
  clearLogButton.addEventListener("click", clearLocalLog);
  configureZonesButton?.addEventListener("click", () => setZoneEditing(true));
  clearZonesButton?.addEventListener("click", clearZoneConfiguration);
  saveZoneButton?.addEventListener("click", saveCurrentZone);
  cancelZoneButton?.addEventListener("click", () => setZoneEditing(false));
  canvas.addEventListener("pointerdown", handleZonePointerDown);
  canvas.addEventListener("pointermove", handleZonePointerMove);
  canvas.addEventListener("pointerup", handleZonePointerUp);
  canvas.addEventListener("pointercancel", handleZonePointerUp);
  video.addEventListener("loadedmetadata", resizeOverlay);
  window.addEventListener("resize", resizeOverlay);
  window.addEventListener("beforeunload", () => stopCamera({ offline: true }));

  setCameraOnline(false);
  setFallCommandStatus("");
  updateLastChamiCommandStatus("Waiting");
  updateZoneStatus("none");
  refreshIdleStage(Date.now(), false);
  renderLogs();
  startCooldownTicker();
  initPoseLandmarker().catch(() => {});
})();
