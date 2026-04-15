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
    this.lastActiveGroupIds = null;
    this.lastAnomaliesCount = null;
    this.lastAnomalySignatures = null;
    this.lastStatusValue = null;
    this.lastAnomaliesValue = null;
    this.client = this.buildClientFromSettings(this.getSettings());

    if (!this.hasCapability('diagral_active_groups_names')) {
      await this.addCapability('diagral_active_groups_names');
    }
    if (!this.hasCapability('diagral_anomalies_summary')) {
      await this.addCapability('diagral_anomalies_summary');
    }
    if (!this.hasCapability('diagral_active_groups_ids')) {
      await this.addCapability('diagral_active_groups_ids');
    }
    if (!this.hasCapability('diagral_last_sync')) {
      await this.addCapability('diagral_last_sync');
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
      apiKey: this.getStoreValue('apiKey') || settings.apiKey || '',
      secretKey: this.getStoreValue('secretKey') || settings.secretKey || '',
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
        return this.getCapabilityValue('diagral_alarm_mode') || 'armed_away';

      case 'ARMING':
        return this.getCapabilityValue('diagral_alarm_mode') || 'disarmed';

      default:
        return this.getCapabilityValue('diagral_alarm_mode') || 'disarmed';
    }
  }

  isTriggered(statusValue, anomaliesValue) {
    const raw = String(statusValue?.status || statusValue?.mode || '').trim().toUpperCase();
    if (raw === 'TRIGGERED' || raw === 'ALARM') return true;

    const alarmCandidates = [
      statusValue?.triggered,
      statusValue?.alarm,
      statusValue?.is_triggered,
      statusValue?.isTriggered,
      anomaliesValue?.triggered,
      anomaliesValue?.alarm,
    ];

    return alarmCandidates.some(value => value === true || value === 1 || value === '1');
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

  async getGroupNameMap() {
    const configGroups = await this.client.getGroupsConfiguration().catch(() => []);
    const byId = new Map();

    for (const g of configGroups) {
      const id = Number(g?.index ?? g?.id ?? g?.group_id);
      const name = String(g?.name ?? g?.label ?? g?.title ?? '').trim();
      if (Number.isFinite(id) && name) byId.set(id, name);
    }

    return byId;
  }

  async getActiveGroupIds(statusValue) {
    const rawStatus = String(statusValue?.status || statusValue?.mode || '').toUpperCase();

    if (rawStatus === 'PRESENCE') {
      return this.client.getPresenceGroups().catch(() => []);
    }

    if (Array.isArray(statusValue?.activated_groups)) {
      return statusValue.activated_groups.map(v => Number(v)).filter(v => Number.isFinite(v));
    }

    if (Array.isArray(statusValue?.groups)) {
      const groups = statusValue.groups;
      if (groups.every(value => typeof value === 'boolean')) {
        return groups
          .map((active, index) => (active ? index + 1 : null))
          .filter(id => Number.isFinite(id));
      }

      return groups.map(value => Number(value)).filter(value => Number.isFinite(value));
    }

    return [];
  }

  async getActiveGroupNames(activeIds) {
    const byId = await this.getGroupNameMap();
    const names = activeIds.map(id => byId.get(id) || `Group ${id}`);
    return names.length ? names.join(', ') : 'Nessuno';
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

  countAnomalies(anomaliesValue) {
    if (!anomaliesValue || typeof anomaliesValue !== 'object') return 0;

    return Object.values(anomaliesValue).reduce((sum, value) => {
      return sum + (Array.isArray(value) ? value.length : 0);
    }, 0);
  }

  async buildGroupMap() {
    const configGroups = await this.client.getGroupsConfiguration().catch(() => []);
    const byId = new Map();

    for (const g of configGroups) {
      const id = Number(g?.index ?? g?.id ?? g?.group_id);
      const name = String(g?.name ?? g?.label ?? g?.title ?? '').trim();
      if (Number.isFinite(id)) byId.set(id, name || `Group ${id}`);
    }

    return byId;
  }

  async buildDeviceMap() {
    const devicesConfig = await this.client.getDevicesConfiguration().catch(() => ({}));
    const byTypeAndIndex = new Map();

    for (const [type, devices] of Object.entries(devicesConfig)) {
      if (!Array.isArray(devices)) continue;

      for (const device of devices) {
        const index = Number(device?.index ?? device?.id);
        const label = String(device?.label ?? device?.name ?? device?.title ?? '').trim();
        if (Number.isFinite(index) && label) {
          byTypeAndIndex.set(`${type}:${index}`, label);
        }
      }
    }

    return byTypeAndIndex;
  }

  async getFlattenedAnomalies(anomaliesValue) {
    if (!anomaliesValue || typeof anomaliesValue !== 'object') return [];

    const [groupMap, deviceMap] = await Promise.all([
      this.buildGroupMap(),
      this.buildDeviceMap(),
    ]);
    const result = [];

    for (const [type, entries] of Object.entries(anomaliesValue)) {
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        const groupId = Number(entry?.group ?? entry?.group_id ?? entry?.groupId);
        const index = Number(entry?.index ?? entry?.device_index ?? entry?.deviceIndex);
        const anomalyNames = Array.isArray(entry?.anomaly_names)
          ? entry.anomaly_names
          : Array.isArray(entry?.anomalyNames)
            ? entry.anomalyNames
            : [];
        const primaryAnomaly = anomalyNames[0] || {};
        const anomalyName = String(
          primaryAnomaly?.name ||
          entry?.name ||
          entry?.anomaly_name ||
          entry?.anomalyName ||
          type
        ).trim();
        const anomalyId = String(primaryAnomaly?.id ?? entry?.id ?? '');
        const groupName = Number.isFinite(groupId)
          ? (groupMap.get(groupId) || `Group ${groupId}`)
          : '';
        const deviceLabel = String(
          entry?.label ||
          (Number.isFinite(index) ? deviceMap.get(`${type}:${index}`) : '') ||
          ''
        ).trim();

        result.push({
          signature: [
            type,
            anomalyId,
            anomalyName,
            entry?.serial || '',
            Number.isFinite(index) ? index : '',
            Number.isFinite(groupId) ? groupId : '',
          ].join('|'),
          anomaly_id: anomalyId,
          anomaly_name: anomalyName,
          device_type: type,
          device_label: deviceLabel,
          group_id: Number.isFinite(groupId) ? String(groupId) : '',
          group_name: groupName,
          serial: String(entry?.serial || ''),
        });
      }
    }

    return result;
  }

  buildAnomaliesSummary(anomalies = []) {
    if (!anomalies.length) return 'Nessuna';

    return anomalies
      .slice(0, 5)
      .map(anomaly => {
        const target = anomaly.device_label || anomaly.group_name || anomaly.device_type;
        return target ? `${anomaly.anomaly_name} su ${target}` : anomaly.anomaly_name;
      })
      .join('; ');
  }

  getLastSyncText() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  async applyState(statusValue, anomaliesValue) {
    const mode = this.mapMode(statusValue);
    const triggered = this.isTriggered(statusValue, anomaliesValue);
    const activeGroupIdsArray = await this.getActiveGroupIds(statusValue);
    const activeGroups = activeGroupIdsArray.length;
    const activeGroupNames = await this.getActiveGroupNames(activeGroupIdsArray);
    const activeGroupIds = activeGroupIdsArray.length ? activeGroupIdsArray.join(', ') : '';
    const anomaliesCount = this.countAnomalies(anomaliesValue);
    const anomalies = await this.getFlattenedAnomalies(anomaliesValue);
    const anomaliesSummary = this.buildAnomaliesSummary(anomalies);
    const anomalySignatures = new Set(anomalies.map(anomaly => anomaly.signature));
    const lastSync = this.getLastSyncText();

    await this.setCapabilityValue('diagral_alarm_mode', mode);
    await this.setCapabilityValue('diagral_alarm_triggered', triggered);
    await this.setCapabilityValue('diagral_active_groups', activeGroups);
    await this.setCapabilityValue('diagral_active_groups_names', activeGroupNames);
    await this.setCapabilityValue('diagral_active_groups_ids', activeGroupIds);
    await this.setCapabilityValue('diagral_anomalies_count', anomaliesCount);
    await this.setCapabilityValue('diagral_anomalies_summary', anomaliesSummary);
    await this.setCapabilityValue('diagral_last_sync', lastSync);

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

    if (
      this.homey.app &&
      typeof this.homey.app.triggerAlarmStatusChanged === 'function' &&
      this.lastMode !== null &&
      (
        this.lastMode !== mode ||
        this.lastActiveGroups !== activeGroups ||
        this.lastActiveGroupNames !== activeGroupNames ||
        this.lastActiveGroupIds !== activeGroupIds ||
        this.lastAnomaliesCount !== anomaliesCount
      )
    ) {
      await this.homey.app.triggerAlarmStatusChanged(this, {
        previous_mode: this.lastMode,
        current_mode: mode,
        active_groups_count: activeGroups,
        active_groups_names: activeGroupNames,
        active_groups_ids: activeGroupIds,
        anomalies_count: anomaliesCount,
      }).catch(() => null);
    }

    if (
      this.homey.app &&
      typeof this.homey.app.triggerAnomalyDetected === 'function' &&
      this.lastAnomalySignatures !== null
    ) {
      const newAnomalies = anomalies.filter(anomaly => !this.lastAnomalySignatures.has(anomaly.signature));
      if (newAnomalies.length) {
        const first = newAnomalies[0];
        await this.homey.app.triggerAnomalyDetected(this, {
          anomaly_count: anomaliesCount,
          anomaly_summary: anomaliesSummary,
          anomaly_id: first.anomaly_id,
          anomaly_name: first.anomaly_name,
          device_type: first.device_type,
          device_label: first.device_label,
          group_id: first.group_id,
          group_name: first.group_name,
          serial: first.serial,
        }).catch(() => null);
      }
    }

    if (
      this.homey.app &&
      typeof this.homey.app.triggerAnomaliesCleared === 'function' &&
      this.lastAnomaliesCount !== null &&
      this.lastAnomaliesCount > 0 &&
      anomaliesCount === 0
    ) {
      await this.homey.app.triggerAnomaliesCleared(this, {
        previous_anomaly_count: this.lastAnomaliesCount,
      }).catch(() => null);
    }

    if (
      this.homey.app &&
      typeof this.homey.app.triggerAnomaliesCountChanged === 'function' &&
      this.lastAnomaliesCount !== null &&
      this.lastAnomaliesCount !== anomaliesCount
    ) {
      await this.homey.app.triggerAnomaliesCountChanged(this, {
        previous_anomalies_count: this.lastAnomaliesCount,
        anomalies_count: anomaliesCount,
        anomaly_summary: anomaliesSummary,
      }).catch(() => null);
    }

    this.lastMode = mode;
    this.lastTriggered = triggered;
    this.lastActiveGroups = activeGroups;
    this.lastActiveGroupNames = activeGroupNames;
    this.lastActiveGroupIds = activeGroupIds;
    this.lastAnomaliesCount = anomaliesCount;
    this.lastAnomalySignatures = anomalySignatures;
    this.lastStatusValue = statusValue;
    this.lastAnomaliesValue = anomaliesValue;
  }

  async ensureApiBootstrap(settings = this.getSettings()) {
    const merged = {
      ...this.getSettings(),
      ...settings,
      apiKey: this.getStoreValue('apiKey') || settings.apiKey,
      secretKey: this.getStoreValue('secretKey') || settings.secretKey,
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

    await this.setStoreValue('apiKey', generated.apiKey);
    await this.setStoreValue('secretKey', generated.secretKey);

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
    const groupId = this.parseGroupId(group);
    await this.setGroupsState(String(groupId), operation, settings);
  }

  async setGroupsState(groups, operation, settings = this.getSettings()) {
    const readySettings = await this.ensureApiBootstrap(settings);

    const groupIds = this.parseGroupIds(groups);
    if (!groupIds.length) {
      throw new Error('Invalid group ids');
    }

    if (operation === 'arm') {
      await this.client.activateGroup(groupIds);
    } else if (operation === 'disarm') {
      await this.client.disableGroup(groupIds);
    } else {
      throw new Error(`Unsupported group operation: ${operation}`);
    }

    await this.sleep(1000);
    await this.syncNow(readySettings);
  }

  parseGroupId(group) {
    const raw = typeof group === 'object' && group !== null
      ? (group.id ?? group.value ?? group.index)
      : group;
    const groupId = Number(raw);
    if (!Number.isFinite(groupId)) {
      throw new Error('Invalid group id');
    }
    return groupId;
  }

  parseGroupIds(groups) {
    if (Array.isArray(groups)) {
      return [...new Set(groups.map(group => this.parseGroupId(group)))];
    }

    if (typeof groups === 'object' && groups !== null) {
      return [this.parseGroupId(groups)];
    }

    return [...new Set(String(groups || '')
      .split(/[;,\s]+/)
      .map(value => Number(value.trim()))
      .filter(value => Number.isFinite(value)))];
  }

  async getGroupAutocompleteResults(query = '') {
    const groups = await this.client.getGroupsConfiguration().catch(() => []);
    const normalizedQuery = String(query || '').trim().toLowerCase();

    return groups
      .map(group => {
        const id = Number(group?.index ?? group?.id ?? group?.group_id);
        const name = String(group?.name ?? group?.label ?? group?.title ?? `Group ${id}`).trim();
        if (!Number.isFinite(id)) return null;

        return {
          id: String(id),
          name: name || `Group ${id}`,
          description: `ID ${id}`,
        };
      })
      .filter(Boolean)
      .filter(group => {
        if (!normalizedQuery) return true;
        return group.name.toLowerCase().includes(normalizedQuery) ||
          group.id.includes(normalizedQuery);
      });
  }

  async isGroupActive(group) {
    const groupId = this.parseGroupId(group);
    const statusValue = this.lastStatusValue || await this.syncNow(this.getSettings());
    const rawStatus = String(statusValue?.status || statusValue?.mode || '').toUpperCase();

    if (rawStatus === 'PRESENCE') {
      const presenceGroups = await this.client.getPresenceGroups();
      return presenceGroups.includes(groupId);
    }

    const activeGroups = Array.isArray(statusValue?.activated_groups)
      ? statusValue.activated_groups.map(value => Number(value))
      : [];
    return activeGroups.includes(groupId);
  }

  hasAnomalies() {
    return Number(this.getCapabilityValue('diagral_anomalies_count') || 0) > 0;
  }

  isAlarmTriggered() {
    return this.getCapabilityValue('diagral_alarm_triggered') === true;
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

  async setPartialMode(partial, settings = this.getSettings()) {
    try {
      const readySettings = await this.ensureApiBootstrap(settings);
      this.rebuildClient(readySettings);

      const partialId = Number(String(partial || '').replace('partial_', ''));
      await this.client.partialStartSystem(partialId);

      await this.sleep(1500);
      await this.syncNow(readySettings);
    } catch (err) {
      this.error('Partial command failed', err);
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
