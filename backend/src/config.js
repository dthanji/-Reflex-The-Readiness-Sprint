const numberFromEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

module.exports = {
  auth: {
    accessTokenTtl: process.env.JWT_ACCESS_TTL || '30m',
  },
  limits: {
    jsonBodyBytes: numberFromEnv('JSON_BODY_LIMIT_BYTES', 32 * 1024),
    metadataBytes: numberFromEnv('METADATA_MAX_BYTES', 8 * 1024),
    metadataDepth: numberFromEnv('METADATA_MAX_DEPTH', 5),
    metadataKeys: numberFromEnv('METADATA_MAX_KEYS', 50),
    metadataArrayItems: numberFromEnv('METADATA_MAX_ARRAY_ITEMS', 50),
    metadataStringLength: numberFromEnv('METADATA_MAX_STRING_LENGTH', 2000),
    clientEventIdLength: numberFromEnv('CLIENT_EVENT_ID_MAX_LENGTH', 128),
    stuckInTransitHours: numberFromEnv('STUCK_IN_TRANSIT_HOURS', 24),
    stuckMonitorMinutes: numberFromEnv('STUCK_MONITOR_MINUTES', 15),
    commentMaxLength: numberFromEnv('RATING_COMMENT_MAX_LENGTH', 500),
  },
  rateLimit: {
    authWindowMs: numberFromEnv('AUTH_RATE_WINDOW_MS', 15 * 60 * 1000),
    authMax: numberFromEnv('AUTH_RATE_MAX', 20),
    apiWindowMs: numberFromEnv('API_RATE_WINDOW_MS', 60 * 1000),
    apiMax: numberFromEnv('API_RATE_MAX', 120),
  },
};
