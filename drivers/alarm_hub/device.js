'use strict';

const Homey = require('homey');
const DiagralClient = require('../../lib/diagral-client');

class AlarmHubDevice extends Homey.Device {
  async onInit() {
    this.pollTimer = null;
    this.lastMode = null;
    this.lastTriggered = null;
    this.lastActiveGroups = null;
    this.lastActiveGroupNames = null;
    this.client = this.buildClientFromSettings(this.getSettings());

    if (!this.hasCapability('diagral_active_groups_names')) {
      await this.addCapability('diagral_active_groups_names');
    }

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
    const raw = String(statusValue?.status || statusValue?.mode || '').trim().toUpperCase();

    switch (raw) {
      case 'OFF':
      case 'STOP':
      case 'DISARMED':
        return 'disarmed';

      case 'PRESENCE':
      case 'TEMPO_1':
      case 'TEMPO_2':
      case 'ARMED_HOME':
      case 'HOME':
      case 'PARTIAL':
        return 'armed_home';

      case 'TEMPO_GROUP':
      case 'GROUP':
      case 'START':
      case 'ON':
      case 'AWAY':
      case 'ARMED_AWAY':
      case 'TOTAL':
      case 'FULL':
        return 'armed_away';

      case 'TRIGGERED':
      case 'ALARM':
        return 'triggered';

      case 'ARMING':
        return this.getCapabilityValue('diagral_alarm_mode') || 'disarmed';

      default:
        return this.getCapabilityValue('diagral_alarm_mode') || 'disarmed';
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

  async getActiveGroupNames(statusValue) {
    const configGroups = await this.client.getGroupsConfiguration().catch(() => []);
    const byId = new Map();

    for (const g of configGroups) {
      const id = Number(g?.index ?? g?.id ?? g?.group_id);
      const name = String(g?.name ?? g?.label ?? g?.title ?? '').trim();
      if (Number.isFinite(id) && name) byId.set(id, name);
    }

    const rawStatus = String(statusValue?.status || statusValue?.mode || '').toUpperCase();

    let activeIds = [];
    if (rawStatus === 'PRESENCE') {
      activeIds = await this.client.getPresenceGroups().catch(() => []);
    } else if (Array.isArray(statusValue?.activated_groups)) {
      activeIds = statusValue.activated_groups.map(v => Number(v)).filter(v => Number.isFinite(v));
    }

    const names = activeIds.map(id => byId.get(id) || `Group ${id}`);
    return names.length ? names.join(', ') : 'None';
  }

  async getAlarmGroupInfo(anomaliesValue) {
    const configGroups = await this.client.getGroupsConfiguration().catch(() => []);
    const byId = new Map();

    for (const g of configGroups) {
      const id = Number(g?.index ?? g?.id ?? g?.group_id);
      const name = String(g?.name ?? g?.label ?? g?.title ?? '').trim();
      if (Number.isFinite(id) && name) byId.set(id, name);
    }

    const candidates = [
      anomaliesValue?.group_id,
      anomaliesValue?.groupId,
      anomaliesValue?.group,
      anomaliesValue?.id_group,
    ];

    let groupId = '';
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n)) {
        groupId = String(n);
        break;
      }
    }

    const groupName =
      anomaliesValue?.group_name ||
      anomaliesValue?.groupName ||
      (groupId ? (byId.get(Number(groupId)) || `Group ${groupId}`) : '');

    return {
      group_id: groupId || '',
      group_name: String(groupName || ''),
    };
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
    const activeGroupNames = await this.getActiveGroupNames(statusValue);
    const anomaliesCount = this.countAnomalies(anomaliesValue);

    await this.setCapabilityValue('diagral_alarm_mode', mode);
    await this.setCapabilityValue('diagral_alarm_triggered', triggered);
    await this.setCapabilityValue('diagral_active_groups', activeGroups);
    await this.setCapabilityValue('diagral_active_groups_names', activeGroupNames);
    await this.setCapabilityValue('diagral_anomalies_count', anomaliesCount);

    if (this.lastMode !== null && this.lastMode !== mode && this.homey.app) {
      if (mode === 'disarmed' && typeof this.homey.app.triggerAlarmDisarmed === 'function') {
        await this.homey.app.triggerAlarmDisarmed(this).catch(() => null);
      }

      if (mode === 'armed_home' && typeof this.homey.app.triggerAlarmArmedHome === 'function') {
        await this.homey.app.triggerAlarmArmedHome(this).catch(() => null);
      }

      if (mode === 'armed_away' && typeof this.homey.app.triggerAlarmArmedAway === 'function') {
        await this.homey.app.triggerAlarmArmedAway(this).catch(() => null);
      }
    }

    if (
      triggered &&
      this.lastTriggered !== true &&
      this.homey.app &&
      typeof this.homey.app.triggerAlarmTriggered === 'function'
    ) {
      const tokens = await this.getAlarmGroupInfo(anomaliesValue).catch(() => ({
        group_id: '',
        group_name: '',
      }));
      await this.homey.app.triggerAlarmTriggered(this, tokens).catch(() => null);
    }

    if (
      this.homey.app &&
      typeof this.homey.app.triggerActiveGroupsChanged === 'function' &&
      this.lastActiveGroups !== null &&
      (
        this.lastActiveGroups !== activeGroups ||
        this.lastActiveGroupNames !== activeGroupNames
      )
    ) {
      await this.homey.app.triggerActiveGroupsChanged(this, {
        active_groups_count: activeGroups,
        active_groups_names: activeGroupNames,
      }).catch(() => null);
    }

    this.lastMode = mode;
    this.lastTriggered = triggered;
    this.lastActiveGroups = activeGroups;
    this.lastActiveGroupNames = activeGroupNames;
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

  async setGroupState(group, operation, settings = this.getSettings()) {
    await this.ensureApiBootstrap(settings);

    const groupId = Number(group);
    if (!Number.isFinite(groupId)) {
      throw new Error('Invalid group id');
    }

    if (operation === 'arm') {
      await this.client.activateGroup([groupId]);
    } else if (operation === 'disarm') {
      await this.client.disableGroup([groupId]);
    } else {
      throw new Error(`Unsupported group operation: ${operation}`);
    }

    await this.sleep(1000);
    await this.syncNow(settings);
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
