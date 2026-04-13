'use strict';

const crypto = require('crypto');

const fetchFn = global.fetch || ((...args) => import('undici').then(({ fetch }) => fetch(...args)));

class DiagralClient {
  constructor({ username, password, serialId, apiKey, secretKey, pinCode }) {
    this.username = (username || '').trim();
    this.password = password || '';
    this.serialId = (serialId || '').trim();
    this.apiKey = (apiKey || '').trim();
    this.secretKey = (secretKey || '').trim();
    this.pinCode = (pinCode || '').trim();
    this.accessToken = null;
    this.configuration = null;
    this.baseUrl = 'https://appv3.tt-monitor.com/emerald/v1';
  }

  setCredentials({ username, password, serialId, apiKey, secretKey, pinCode }) {
    this.username = (username || '').trim();
    this.password = password || '';
    this.serialId = (serialId || '').trim();
    this.apiKey = (apiKey || '').trim();
    this.secretKey = (secretKey || '').trim();
    this.pinCode = (pinCode || '').trim();
    this.accessToken = null;
    this.configuration = null;
  }

  static normalizeError(err) {
    const message = String(err && err.message ? err.message : err || 'Unknown error');

    if (message.includes('Missing required setting: serialId')) {
      return 'Serial ID mancante nelle impostazioni';
    }
    if (message.includes('Missing required setting: pinCode')) {
      return 'PIN mancante nelle impostazioni';
    }
    if (message.includes('Missing required settings for bootstrap: username/password')) {
      return 'Inserisci email e password nelle impostazioni';
    }
    if (message.includes('Missing API key or secret key')) {
      return 'Impossibile generare o usare API key e secret key';
    }
    if (message.includes('401') && message.includes('Invalid HMAC signature')) {
      return 'API key o secret key non valide';
    }
    if (message.includes('401') && message.includes('Missing signature')) {
      return 'API key, secret key o timestamp mancanti';
    }
    if (message.includes('/status') && message.includes('404')) {
      return 'Serial ID non trovato per questa installazione';
    }
    if (message.includes('users/authenticate/login') && message.includes('401')) {
      return 'Email o password non valide';
    }
    if (
      message.includes('fetch failed') ||
      message.includes('ENOTFOUND') ||
      message.includes('ETIMEDOUT')
    ) {
      return 'Connessione al cloud Diagral non riuscita';
    }

    return message;
  }

  async request(path, options = {}) {
    const res = await fetchFn(`${this.baseUrl}${path}`, options);
    const text = await res.text();

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${path}: ${JSON.stringify(json)}`);
    }

    return json;
  }

  async login() {
    const json = await this.request('/users/authenticate/login?vendor=DIAGRAL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    this.accessToken = json?.access_token || json?.accessToken || null;

    if (!this.accessToken) {
      throw new Error('Missing access token after login');
    }

    return json;
  }

  async ensureLoggedIn() {
    if (!this.accessToken) {
      await this.login();
    }
  }

  async createApiKey() {
    await this.ensureLoggedIn();

    const json = await this.request('/users/api_key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ serial_id: this.serialId }),
    });

    this.apiKey = (json?.api_key || json?.apikey || '').trim();
    this.secretKey = (json?.secret_key || json?.secretKey || '').trim();

    if (!this.apiKey || !this.secretKey) {
      throw new Error('Missing apiKey/secretKey after API key creation');
    }

    return { apiKey: this.apiKey, secretKey: this.secretKey };
  }

  async ensureApiKeys() {
    if (this.apiKey && this.secretKey) {
      return { apiKey: this.apiKey, secretKey: this.secretKey };
    }
    return this.createApiKey();
  }

  async generateApiKeysFromCredentials() {
    await this.login();
    return this.createApiKey();
  }

  signedHeaders(includePin = false) {
    if (!this.apiKey || !this.secretKey) {
      throw new Error('Missing API key or secret key');
    }
    if (!this.serialId) {
      throw new Error('Missing required setting: serialId');
    }

    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = `${timestamp}.${this.serialId}.${this.apiKey}`;
    const hmac = crypto.createHmac('sha256', this.secretKey).update(message).digest('hex');

    const headers = {
      'X-HMAC': hmac,
      'X-TIMESTAMP': timestamp,
      'X-APIKEY': this.apiKey,
    };

    if (includePin) {
      if (!this.pinCode) {
        throw new Error('Missing required setting: pinCode');
      }
      headers['X-PIN-CODE'] = this.pinCode;
    }

    return headers;
  }

  async ensureReadyForSignedCalls() {
    if (!this.serialId) {
      throw new Error('Missing required setting: serialId');
    }

    if (this.apiKey && this.secretKey) return;

    if (!this.username || !this.password) {
      throw new Error('Missing required settings for bootstrap: username/password');
    }

    await this.ensureApiKeys();
  }

  async getSystemStatus() {
    await this.ensureReadyForSignedCalls();
    return this.request(`/systems/${this.serialId}/status`, {
      method: 'GET',
      headers: this.signedHeaders(true),
    });
  }

  async getAnomalies() {
    await this.ensureReadyForSignedCalls();
    return this.request(`/systems/${this.serialId}/anomalies`, {
      method: 'GET',
      headers: this.signedHeaders(false),
    });
  }

  async startSystem() {
    await this.ensureReadyForSignedCalls();
    return this.request(`/systems/${this.serialId}/start`, {
      method: 'POST',
      headers: this.signedHeaders(true),
    });
  }

  async presence() {
    await this.ensureReadyForSignedCalls();
    return this.request(`/systems/${this.serialId}/presence`, {
      method: 'POST',
      headers: this.signedHeaders(true),
    });
  }

  async stopSystem() {
    await this.ensureReadyForSignedCalls();
    return this.request(`/systems/${this.serialId}/stop`, {
      method: 'POST',
      headers: this.signedHeaders(true),
    });
  }

  async activateGroup(groups = []) {
    await this.ensureReadyForSignedCalls();
    return this.request(`/systems/${this.serialId}/activate_group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.signedHeaders(true),
      },
      body: JSON.stringify({ groups }),
    });
  }

  async disableGroup(groups = []) {
    await this.ensureReadyForSignedCalls();
    return this.request(`/systems/${this.serialId}/disable_group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.signedHeaders(true),
      },
      body: JSON.stringify({ groups }),
    });
  }

  async getConfiguration() {
    await this.ensureReadyForSignedCalls();

    if (this.configuration) {
      return this.configuration;
    }

    const json = await this.request(`/systems/${this.serialId}/configurations`, {
      method: 'GET',
      headers: this.signedHeaders(false),
    });

    this.configuration = json;
    return json;
  }

  async getPresenceGroups() {
    const config = await this.getConfiguration();

    const candidates = [
      config?.presence_group,
      config?.presenceGroup,
      config?.grp_marche_partielle2,
      config?.grpMarchePartielle2,
    ];

    for (const value of candidates) {
      if (Array.isArray(value)) {
        const parsed = value
          .map(v => Number(v))
          .filter(v => Number.isFinite(v));
        if (parsed.length) return parsed;
      }

      if (typeof value === 'string') {
        const parsed = value
          .split(/[;,\s]+/)
          .map(v => Number(v.trim()))
          .filter(v => Number.isFinite(v));
        if (parsed.length) return parsed;
      }
    }

    return [];
  }

  async getGroupsConfiguration() {
    const config = await this.getConfiguration();

    const groups = config?.groups || config?.groupes || config?.group || [];
    if (Array.isArray(groups)) return groups;

    return [];
  }

  getKeys() {
    return {
      apiKey: this.apiKey,
      secretKey: this.secretKey,
    };
  }
}

module.exports = DiagralClient;
