export class UpstashRedis {
  constructor({ url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN, fetchImpl = globalThis.fetch } = {}) {
    this.url = String(url || '').trim().replace(/\/+$/, '');
    this.token = String(token || '').trim();
    this.fetchImpl = fetchImpl;
  }

  get isConfigured() {
    return Boolean(this.url && this.token);
  }

  async command(...command) {
    const payload = await this.request('', command);
    return payload.result;
  }

  async pipeline(commands) {
    if (!commands.length) return [];
    const payload = await this.request('/pipeline', commands);
    if (!Array.isArray(payload)) throw new Error('Invalid Upstash pipeline response');
    return payload.map(item => {
      if (item?.error) throw new Error(String(item.error));
      return item?.result;
    });
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

  async request(path, body) {
    if (!this.isConfigured) throw new Error('Upstash Redis is not configured');
    const response = await this.fetchImpl(`${this.url}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error) throw new Error(payload?.error || `Upstash request failed (${response.status})`);
    return payload;
  }
}
