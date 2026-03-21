type JsonObject = Record<string, unknown>;

const STREAM_MODES = new Set(['udp', 'echo']);

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOptionalString(config: JsonObject, key: string) {
  const value = config[key];
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new Error(`streamConfig.${key} must be a string`);
  }
}

function assertOptionalNumber(config: JsonObject, key: string) {
  const value = config[key];
  if (value !== undefined && value !== null && typeof value !== 'number') {
    throw new Error(`streamConfig.${key} must be a number`);
  }
}

function assertOptionalArray(config: JsonObject, key: string) {
  const value = config[key];
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    throw new Error(`streamConfig.${key} must be an array`);
  }
}

export function validateStreamConfig(input: unknown): JsonObject | null {
  if (input === undefined || input === null) {
    return null;
  }

  let normalizedInput = input;
  if (typeof normalizedInput === 'string') {
    const trimmed = normalizedInput.trim();
    if (!trimmed) {
      return null;
    }

    try {
      normalizedInput = JSON.parse(trimmed);
    } catch {
      throw new Error('streamConfig must be valid JSON');
    }
  }

  if (!isPlainObject(normalizedInput)) {
    throw new Error('streamConfig must be a JSON object');
  }

  const config: JsonObject = { ...normalizedInput };
  const mode = config.mode;
  if (mode !== undefined) {
    if (typeof mode !== 'string' || !STREAM_MODES.has(mode)) {
      throw new Error('streamConfig.mode must be "udp" or "echo"');
    }
  }

  assertOptionalString(config, 'source');
  assertOptionalString(config, 'page_url');
  assertOptionalString(config, 'cookies_b64');
  assertOptionalString(config, 'note');
  assertOptionalNumber(config, 'timestamp');
  assertOptionalArray(config, 'streams');
  assertOptionalArray(config, 'licenses');
  assertOptionalArray(config, 'keys');

  const headers = config.headers;
  if (
    headers !== undefined &&
    headers !== null &&
    typeof headers !== 'string' &&
    !isPlainObject(headers)
  ) {
    throw new Error('streamConfig.headers must be a string or object');
  }

  return config;
}

export function serializeStreamConfig(input: unknown): string | null {
  const validated = validateStreamConfig(input);
  return validated ? JSON.stringify(validated) : null;
}
