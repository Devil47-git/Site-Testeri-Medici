import '../config.js';

export class SupabaseKV {
  constructor({
    url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl = globalThis.fetch
  } = {}) {
    this.url = String(url || '').trim().replace(/\/+$/, '');
    this.key = String(key || '').trim();
    this.fetchImpl = fetchImpl;
  }

  get isConfigured() {
    return Boolean(this.url && this.key);
  }

  async command(command, ...args) {
    return this.request('/rpc/app_kv_execute', { p_command: String(command).toUpperCase(), p_args: args });
  }

  async pipeline(commands) {
    if (!commands.length) return [];
    const result = await this.request('/rpc/app_kv_pipeline', { p_commands: commands });
    if (!Array.isArray(result)) throw new Error('Invalid Supabase storage pipeline response');
    return result;
  }

  async getJson(key) {
    const value = await this.command('GET', key);
    return value == null ? null : JSON.parse(value);
  }

  async setJson(key, value, { expirationSeconds } = {}) {
    const command = ['SET', key, JSON.stringify(value)];
    if (Number.isInteger(expirationSeconds) && expirationSeconds > 0) command.push('EX', String(expirationSeconds));
    return this.command(...command);
  }

  async delete(key) {
    return this.command('DEL', key);
  }

  async importEntries(entries) {
    return this.request('/rpc/app_kv_import', { p_entries: entries });
  }

  async request(path, body) {
    if (!this.isConfigured) throw new Error('Supabase storage is not configured');
    const response = await this.fetchImpl(`${this.url}/rest/v1${path}`, {
      method: 'POST',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message || payload?.error || `Supabase request failed (${response.status})`;
      throw new Error(String(message));
    }
    return payload;
  }
}
