const { limits } = require('./config');

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function validateMetadata(metadata) {
  if (metadata === undefined) return {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('metadata must be a JSON object');
  }
  if (byteLength(metadata) > limits.metadataBytes) throw new Error(`metadata exceeds ${limits.metadataBytes} bytes`);

  let keys = 0;
  function walk(value, depth) {
    if (depth > limits.metadataDepth) throw new Error(`metadata nesting exceeds ${limits.metadataDepth} levels`);
    if (typeof value === 'string' && value.length > limits.metadataStringLength) {
      throw new Error(`metadata strings exceed ${limits.metadataStringLength} characters`);
    }
    if (Array.isArray(value)) {
      if (value.length > limits.metadataArrayItems) throw new Error(`metadata arrays exceed ${limits.metadataArrayItems} items`);
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        keys += 1;
        if (keys > limits.metadataKeys) throw new Error(`metadata exceeds ${limits.metadataKeys} keys`);
        if (key.length > 128) throw new Error('metadata key is too long');
        walk(child, depth + 1);
      }
    }
  }
  walk(metadata, 0);
  return metadata;
}

function validateClientEventId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > limits.clientEventIdLength) {
    throw new Error(`client_event_id must be a string of at most ${limits.clientEventIdLength} characters`);
  }
  return value;
}

module.exports = { validateMetadata, validateClientEventId };
