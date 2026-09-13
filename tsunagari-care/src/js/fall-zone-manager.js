(function () {
  const DEFAULT_STORAGE_KEY = "tsunagariCareFallZones";
  const SUPPORTED_TYPES = ["bed", "sofa", "floor"];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizePoint(point) {
    return {
      x: clamp(Number(point?.x) || 0, 0, 1),
      y: clamp(Number(point?.y) || 0, 0, 1),
    };
  }

  function normalizeType(type) {
    return SUPPORTED_TYPES.includes(type) ? type : "floor";
  }

  function normalizeZone(zone) {
    const points = Array.isArray(zone?.points)
      ? zone.points.slice(0, 4).map(normalizePoint)
      : [];

    if (points.length < 4) return null;

    return {
      id: String(zone.id || `${normalizeType(zone.type)}_${Date.now()}`),
      type: normalizeType(zone.type),
      points,
    };
  }

  function normalizeRect(rect) {
    const minX = clamp(Math.min(rect.startX, rect.endX), 0, 1);
    const maxX = clamp(Math.max(rect.startX, rect.endX), 0, 1);
    const minY = clamp(Math.min(rect.startY, rect.endY), 0, 1);
    const maxY = clamp(Math.max(rect.startY, rect.endY), 0, 1);

    return { minX, maxX, minY, maxY };
  }

  function rectToPoints(rect) {
    const normalized = normalizeRect(rect);

    return [
      { x: normalized.minX, y: normalized.minY },
      { x: normalized.maxX, y: normalized.minY },
      { x: normalized.maxX, y: normalized.maxY },
      { x: normalized.minX, y: normalized.maxY },
    ];
  }

  function getBoundingRect(zone) {
    const points = Array.isArray(zone?.points) ? zone.points : [];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);

    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }

  function pointInRect(point, zone) {
    if (!point || !zone || !Array.isArray(zone.points)) return false;

    const rect = getBoundingRect(zone);
    return (
      point.x >= rect.minX &&
      point.x <= rect.maxX &&
      point.y >= rect.minY &&
      point.y <= rect.maxY
    );
  }

  function createZoneManager(options = {}) {
    const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    let zones = [];

    function load() {
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
        zones = (Array.isArray(parsed) ? parsed : [])
          .map(normalizeZone)
          .filter(Boolean);
      } catch (error) {
        zones = [];
      }

      return getZones();
    }

    function save() {
      localStorage.setItem(storageKey, JSON.stringify(zones));
    }

    function getZones() {
      return zones.map((zone) => ({
        id: zone.id,
        type: zone.type,
        points: zone.points.map((point) => ({ ...point })),
      }));
    }

    function addRectangle(type, rect) {
      const points = rectToPoints(rect);
      const zone = {
        id: `${normalizeType(type)}_${Date.now()}`,
        type: normalizeType(type),
        points,
      };

      zones.push(zone);
      save();
      return zone;
    }

    function clear() {
      zones = [];
      localStorage.removeItem(storageKey);
    }

    function hasZone(type) {
      return zones.some((zone) => zone.type === type);
    }

    function classifyPoint(point) {
      if (!point) return null;

      const match = zones.find((zone) => pointInRect(point, zone));
      return match || null;
    }

    function getSummary() {
      if (!zones.length) return "Not configured";

      const counts = zones.reduce((acc, zone) => {
        acc[zone.type] = (acc[zone.type] || 0) + 1;
        return acc;
      }, {});

      return SUPPORTED_TYPES.filter((type) => counts[type])
        .map((type) => `${type}:${counts[type]}`)
        .join(", ");
    }

    load();

    return {
      addRectangle,
      classifyPoint,
      clear,
      getSummary,
      getZones,
      hasZone,
      load,
      storageKey,
    };
  }

  window.TsunagariFallZoneManager = {
    createZoneManager,
    pointInRect,
    rectToPoints,
    supportedTypes: SUPPORTED_TYPES,
  };
})();
