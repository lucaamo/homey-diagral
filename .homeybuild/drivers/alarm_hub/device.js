'use strict';

const Homey = require('homey');
const DiagralClient = require('../../lib/diagral-client');

class AlarmHubDevice extends Homey.Device {
  async onInit() {
    this.pollTimer = null;
    this.lastMode = null;
    this.lastTriggered = null;
    this.client = this.buildClientFromSettings(this.getSettings());

    this.registerCapabilityListeners();
    await this.bootstrapState(this.getSettings());
    this.startPolling();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  buildClientFromSettings(settings = {}) {
    return new DiagralClient({
      username: settings.username || '',
      password: settings.password || '',
      serialId: settings.serialId || '',
      pinCode: settings.pinCode || '',
      apiKey: settings.apiKey || '',
      secretKey: settings.secretKey || '',
      pollInterval: settings.pollInterval || 180,
    });
  }

  registerCapabilityListeners() {
    if (this.hasCapability('diagral_alarm_mode')) {
      this.registerCapabilityListener('diagral_alarm_mode', async value => {
        await this.setAlarmMode(value, this.getSettings());
        return true;
      });
    }
  }

  getAlarmMode() {
    return this.getCapabilityValue('diagral_alarm_mode') || 'disarmed';
  }

  rebuildClient(settings = this.getSettings()) {
    this.client = this.buildClientFromSettings(settings);
  }

  stopPolling() {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  mapMode(statusValue) {
    const raw = String(statusValue?.status || statusValue?.mode || '').toUpperCase();

    switch (raw) {
      case 'PRESENCE':
        return 'armed_home';
      case 'START':
        return 'armed_away';
      case 'STOP':
        return 'disarmed';
      case 'TRIGGERED':
      case 'ALARM':
        return 'armed_away';
      case 'ARMING':
        return this.getCapabilityValue('diagral_alarm_mode') || 'disarmed';
      default:
        return 'disarmed';
    }
  }

  countActiveGroups(statusValue) {
    if (Array.isArray(statusValue?.activated_groups)) {
      return statusValue.activated_groups.length;
    }

    if (Array.isArray(statusValue?.groups)) {
      return statusValue.groups.filter(Boolean).length;
    }

    return 0;
  }

  async getActiveGroupsCount(statusValue) {
    const rawStatus = String(statusValue?.status || statusValue?.mode || '').toUpperCase();

    if (rawStatus === 'PRESENCE') {
      const presenceGroups = await this.client.getPresenceGroups();
      return presenceGroups.length;
    }

    return this.countActiveGroups(statusValue);
  }

  countAnomalies(anomaliesValue) {
    if (!anomaliesValue || typeof anomaliesValue !== 'object') return 0;

    return Object.values(anomaliesValue).reduce((sum, value) => {
      return sum + (Array.isArray(value) ? value.length : 0);
    }, 0);
  }

  async applyState(statusValue, anomaliesValue) {
    const mode = this.mapMode(statusValue);
    const triggered = mode === 'triggered';
    const activeGroups = await this.getActiveGroupsCount(statusValue);
    const anomaliesCount = this.countAnomalies(anomaliesValue);

    await this.setCapabilityValue('diagral_alarm_mode', mode);
    await this.setCapabilityValue('diagral_alarm_triggered', triggered);
    await this.setCapabilityValue('diagral_active_groups', activeGroups);
    await this.setCapabilityValue('diagral_anomalies_count', anomaliesCount);

    if (
      this.lastMode !== null &&
      this.lastMode !== mode &&
      this.homey.app &&
      typeof this.homey.app.triggerModeChanged === 'function'
    ) {
      await this.homey.app.triggerModeChanged(this, mode).catch(() => null);
    }

    this.lastMode = mode;
    this.lastTriggered = triggered;
  }

  async ensureApiBootstrap(settings = this.getSettings()) {
    const merged = {
      ...this.getSettings(),
      ...settings,
    };

    if (!merged.serialId) {
      throw new Error('Missing required setting: serialId');
    }

    if (!merged.pinCode) {
      throw new Error('Missing required setting: pinCode');
    }

    if (merged.apiKey && merged.secretKey) {
      this.rebuildClient(merged);
      return merged;
    }

    if (!merged.username) {
      throw new Error('Missing required setting: username');
    }

    if (!merged.password) {
      throw new Error('Missing required setting: password');
    }

    const bootstrapClient = this.buildClientFromSettings(merged);
    const generated = await bootstrapClient.generateApiKeysFromCredentials();

    const patchedSettings = {
      ...merged,
      apiKey: generated.apiKey,
      secretKey: generated.secretKey,
    };

    await this.setSettings({
      apiKey: generated.apiKey,
      secretKey: generated.secretKey,
    });

    this.rebuildClient(patchedSettings);
    return patchedSettings;
  }

  async bootstrapState(settings = this.getSettings()) {
    try {
      await this.syncNow(settings);
      await this.setAvailable();
    } catch (err) {
      this.error('Bootstrap failed', err);
      await this.setUnavailable(DiagralClient.normalizeError(err));
    }
  }

  async syncNow(settings = this.getSettings()) {
    const readySettings = await this.ensureApiBootstrap(settings);
    this.rebuildClient(readySettings);

    const [statusResult, anomaliesResult] = await Promise.allSettled([
      this.client.getSystemStatus(),
      this.client.getAnomalies(),
    ]);

    if (statusResult.status !== 'fulfilled') {
      throw statusResult.reason;
    }

    const statusValue = statusResult.value;
    const anomaliesValue =
      anomaliesResult.status === 'fulfilled' ? anomaliesResult.value : {};

    await this.applyState(statusValue, anomaliesValue);
    await this.setAvailable();

    return statusValue;
  }

  async setAlarmMode(mode, settings = this.getSettings()) {
    try {
      const readySettings = await this.ensureApiBootstrap(settings);
      this.rebuildClient(readySettings);

      if (mode === 'armed_home') {
        await this.client.presence();
      } else if (mode === 'armed_away') {
        await this.client.startSystem();
      } else if (mode === 'disarmed') {
        await this.client.stopSystem();
      } else {
        throw new Error(`Modalità non supportata: ${mode}`);
      }

      await this.sleep(1500);
      await this.syncNow(readySettings);
    } catch (err) {
      this.error('Command failed', err);
      throw new Error(DiagralClient.normalizeError(err));
    }
  }

  startPolling() {
    this.stopPolling();

    const seconds = Math.max(60, Number(this.getSettings().pollInterval || 180));

    this.pollTimer = this.homey.setInterval(async () => {
      try {
        await this.syncNow(this.getSettings());
      } catch (err) {
        this.error('Polling failed', err);
        await this.setUnavailable(DiagralClient.normalizeError(err)).catch(() => null);
      }
    }, seconds * 1000);
  }

  async onSettings({ changedKeys, newSettings }) {
    this.log('Settings updated', changedKeys);

    try {
      this.stopPolling();
      this.rebuildClient(newSettings);
      await this.bootstrapState(newSettings);
      this.startPolling();
      return true;
    } catch (err) {
      this.error('Refresh after settings failed', err);
      throw new Error(DiagralClient.normalizeError(err));
    }
  }

  async onDeleted() {
    this.stopPolling();
  }
}

module.exports = AlarmHubDevice;
