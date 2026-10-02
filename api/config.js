export function loadAppConfig(environment = process.env) {
  const serialized = String(environment.APP_CONFIG_JSON || '').trim();
  if (!serialized) return environment;

  let config;
  try {
    config = JSON.parse(serialized);
  } catch {
    throw new Error('APP_CONFIG_JSON must contain a valid JSON object');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('APP_CONFIG_JSON must contain a valid JSON object');
  }

  for (const [name, value] of Object.entries(config)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || name === 'APP_CONFIG_JSON' || value == null) continue;
    const normalized = typeof value === 'string' ? value : JSON.stringify(value);
    if (normalized) environment[name] = normalized;
  }
  return environment;
}

loadAppConfig();