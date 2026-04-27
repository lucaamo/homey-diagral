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
    this.pollFailures = 0;
    this.lastWebhookAlarmSignature = null;
    this.webhookAlarmActive = false;
    this.syncQueue = Promise.resolve();
    this.client = this.buildClientFromSettings(this.getSettings());

    if (!this.hasCapability('diagral_alarm_mode_label')) {
      await this.addCapability('diagral_alarm_mode_label');
    }
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
    await this.registerDiagralWebhookIfAvailable().catch(err => {
      this.error('Diagral webhook registration failed', err);
    });
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

  getAlarmModeLabel(mode) {
    switch (mode) {
      case 'disarmed':
        return 'Spento';
      case 'armed_home':
        return 'Parziale';
      case 'armed_away':
        return 'Totale';
      default:
        return mode || 'Sconosciuto';
    }
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
    if (raw === 'TRIGGERED' || raw === 'ALARM' || raw === 'ALERT') return true;

    const alarmCandidates = [
      statusValue?.triggered,
      statusValue?.alarm,
      statusValue?.is_triggered,
      statusValue?.isTriggered,
      anomaliesValue?.triggered,
      anomaliesValue?.alarm,
    ];

    if (alarmCandidates.some(value => value === true || value === 1 || value === '1')) return true;

    const alertCodes = new Set([
      1130, // intrusion
      1139, // intrusion confirmed
      1141, // prealarm confirmed
    ]);

    return this.walkValues([statusValue, anomaliesValue], value => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return false;

      const numeric = Number(normalized);
      if (Number.isFinite(numeric) && alertCodes.has(numeric)) return true;

      return normalized.includes('intrusion') ||
        normalized.includes('alert') ||
        normalized.includes('alarm triggered') ||
        normalized.includes('allarme scattato');
    });
  }

  walkValues(input, predicate) {
    const stack = Array.isArray(input) ? [...input] : [input];
    const seen = new Set();

    while (stack.length) {
      const value = stack.pop();
      if (predicate(value)) return true;

      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);

      if (Array.isArray(value)) {
        stack.push(...value);
      } else {
        stack.push(...Object.values(value));
      }
    }

    return false;
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

  async getAlarmGroupInfo(anomaliesValue, statusValue = this.lastStatusValue || {}) {
    const configGroups = await this.client.getGroupsConfiguration().catch(() => []);
    const byId = new Map();

    for (const g of configGroups) {
      const id = Number(g?.index ?? g?.id ?? g?.group_id);
      const name = String(g?.name ?? g?.label ?? g?.title ?? '').trim();
      if (Number.isFinite(id) && name) byId.set(id, name);
    }

    const activeIds = await this.getActiveGroupIds(statusValue).catch(() => []);
    const alarmEntries = await this.getFlattenedAnomalies(anomaliesValue).catch(() => []);
    const alertEntry = alarmEntries.find(entry => this.isAlarmLikeEntry(entry)) || alarmEntries[0] || {};

    const candidates = [
      anomaliesValue?.group_id,
      anomaliesValue?.groupId,
      anomaliesValue?.group,
      anomaliesValue?.id_group,
      anomaliesValue?.group_index,
      anomaliesValue?.groupIndex,
      alertEntry.group_id,
      activeIds[0],
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
      anomaliesValue?.group_label ||
      anomaliesValue?.groupLabel ||
      alertEntry.group_name ||
      (groupId ? (byId.get(Number(groupId)) || `Group ${groupId}`) : '');

    return {
      group_id: groupId || '',
      group_name: String(groupName || ''),
    };
  }

  isAlarmLikeEntry(entry = {}) {
    const text = [
      entry.anomaly_id,
      entry.anomaly_name,
      entry.alarm_description,
      entry.device_type,
      entry.device_label,
    ].filter(Boolean).join(' ').toLowerCase();

    const code = Number(entry.anomaly_id);
    return [1130, 1139, 1141].includes(code) ||
      text.includes('intrusion') ||
      text.includes('alert') ||
      text.includes('alarm');
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
        const groupId = Number(
          entry?.group ??
          entry?.group_id ??
          entry?.groupId ??
          entry?.group_index ??
          entry?.groupIndex
        );
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
          entry?.alarm_description ||
          entry?.alarmDescription ||
          type
        ).trim();
        const anomalyId = String(primaryAnomaly?.id ?? entry?.id ?? '');
        const alarmCode = String(entry?.alarm_code ?? entry?.alarmCode ?? '');
        const alarmDescription = String(entry?.alarm_description ?? entry?.alarmDescription ?? '').trim();
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
            alarmCode,
            anomalyName,
            entry?.serial || '',
            Number.isFinite(index) ? index : '',
            Number.isFinite(groupId) ? groupId : '',
          ].join('|'),
          anomaly_id: anomalyId || alarmCode,
          anomaly_name: anomalyName,
          alarm_description: alarmDescription,
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
    const detectedTriggered = this.isTriggered(statusValue, anomaliesValue);
    const triggered = detectedTriggered || (this.lastTriggered === true && mode !== 'disarmed');
    const activeGroupIdsArray = await this.getActiveGroupIds(statusValue);
    const activeGroups = activeGroupIdsArray.length;
    const activeGroupNames = await this.getActiveGroupNames(activeGroupIdsArray);
    const activeGroupIds = activeGroupIdsArray.length ? activeGroupIdsArray.join(', ') : '';
    const anomaliesCount = this.countAnomalies(anomaliesValue);
    const anomalies = await this.getFlattenedAnomalies(anomaliesValue);
    const anomaliesSummary = this.buildAnomaliesSummary(anomalies);
    const anomalySignatures = new Set(anomalies.map(anomaly => anomaly.signature));
    const lastSync = this.getLastSyncText();
    const previous = {
      mode: this.lastMode,
      triggered: this.lastTriggered,
      activeGroups: this.lastActiveGroups,
      activeGroupNames: this.lastActiveGroupNames,
      activeGroupIds: this.lastActiveGroupIds,
      anomaliesCount: this.lastAnomaliesCount,
      anomalySignatures: this.lastAnomalySignatures,
    };

    await this.setCapabilityValue('diagral_alarm_mode', mode);
    await this.setCapabilityValue('diagral_alarm_mode_label', this.getAlarmModeLabel(mode));
    await this.setCapabilityValue('diagral_alarm_triggered', triggered);
    await this.setCapabilityValue('diagral_active_groups', activeGroups);
    await this.setCapabilityValue('diagral_active_groups_names', activeGroupNames);
    await this.setCapabilityValue('diagral_active_groups_ids', activeGroupIds);
    await this.setCapabilityValue('diagral_anomalies_count', anomaliesCount);
    await this.setCapabilityValue('diagral_anomalies_summary', anomaliesSummary);
    await this.setCapabilityValue('diagral_last_sync', lastSync);

    this.lastMode = mode;
    this.lastTriggered = triggered;
    this.lastActiveGroups = activeGroups;
    this.lastActiveGroupNames = activeGroupNames;
    this.lastActiveGroupIds = activeGroupIds;
    this.lastAnomaliesCount = anomaliesCount;
    this.lastAnomalySignatures = anomalySignatures;
    this.lastStatusValue = statusValue;
    this.lastAnomaliesValue = anomaliesValue;

    if (previous.mode !== null && previous.mode !== mode && this.homey.app) {
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
      detectedTriggered &&
      previous.triggered !== true &&
      this.homey.app &&
      typeof this.homey.app.triggerAlarmTriggered === 'function'
    ) {
      const tokens = await this.getAlarmGroupInfo(anomaliesValue, statusValue).catch(() => ({
        group_id: '',
        group_name: '',
      }));
      await this.homey.app.triggerAlarmTriggered(this, tokens).catch(() => null);
    }

    if (
      this.homey.app &&
      typeof this.homey.app.triggerActiveGroupsChanged === 'function' &&
      previous.activeGroups !== null &&
      (
        previous.activeGroups !== activeGroups ||
        previous.activeGroupIds !== activeGroupIds
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
      previous.mode !== null &&
      previous.mode !== mode
    ) {
      await this.homey.app.triggerAlarmStatusChanged(this, {
        previous_mode: previous.mode,
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
      previous.anomalySignatures !== null
    ) {
      const newAnomalies = anomalies.filter(anomaly => !previous.anomalySignatures.has(anomaly.signature));
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
      previous.anomaliesCount !== null &&
      previous.anomaliesCount > 0 &&
      anomaliesCount === 0
    ) {
      await this.homey.app.triggerAnomaliesCleared(this, {
        previous_anomaly_count: previous.anomaliesCount,
      }).catch(() => null);
    }

    if (
      this.homey.app &&
      typeof this.homey.app.triggerAnomaliesCountChanged === 'function' &&
      previous.anomaliesCount !== null &&
      previous.anomaliesCount !== anomaliesCount
    ) {
      await this.homey.app.triggerAnomaliesCountChanged(this, {
        previous_anomalies_count: previous.anomaliesCount,
        anomalies_count: anomaliesCount,
        anomaly_summary: anomaliesSummary,
      }).catch(() => null);
    }
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
      this.pollFailures = 0;
      await this.setAvailable();
    } catch (err) {
      this.error('Bootstrap failed', err);
      await this.setUnavailable(DiagralClient.normalizeError(err));
    }
  }

  async registerDiagralWebhookIfAvailable() {
    if (!this.homey.app || typeof this.homey.app.getDiagralWebhookUrl !== 'function') return;

    const settings = this.getSettings();
    const webhookUrl = await this.homey.app.getDiagralWebhookUrl(settings);
    if (!webhookUrl) return;

    const readySettings = await this.ensureApiBootstrap(settings);
    this.rebuildClient(readySettings);
    await this.client.upsertWebhook(webhookUrl);
    this.log('Diagral webhook registered', webhookUrl);
  }

  async handleDiagralWebhook(payload = {}) {
    const eventType = this.getWebhookEventType(payload);
    const alarmCode = String(payload?.alarm_code ?? payload?.alarmCode ?? '').trim();
    const alarmDescription = String(
      payload?.alarm_description ??
      payload?.alarmDescription ??
      ''
    ).trim();

    this.log('Diagral webhook event', {
      eventType,
      alarmCode,
      alarmDescription,
      groupIndex: payload?.group_index ?? payload?.groupIndex ?? '',
    });

    if (eventType === 'STATUS' && this.isDisarmWebhook(payload)) {
      this.webhookAlarmActive = false;
      this.lastWebhookAlarmSignature = null;
      this.lastTriggered = false;
      await this.setCapabilityValue('diagral_alarm_triggered', false).catch(() => null);
      await this.setCapabilityValue('diagral_alarm_mode', 'disarmed').catch(() => null);
      await this.setCapabilityValue('diagral_alarm_mode_label', this.getAlarmModeLabel('disarmed')).catch(() => null);
    }

    if (eventType === 'STATUS' || eventType === 'ANOMALY') {
      await this.syncNow(this.getSettings()).catch(err => {
        this.error('Webhook refresh failed', err);
      });
    }

    if (eventType !== 'ALERT' || !this.isIntrusionWebhook(payload)) {
      return;
    }

    if (this.webhookAlarmActive) {
      this.log('Diagral webhook alarm ignored because alarm episode is already active', {
        alarmCode,
        groupIndex: payload?.group_index ?? payload?.groupIndex ?? '',
      });
      return;
    }

    const tokens = await this.getWebhookAlarmTokens(payload);
    const signature = [
      alarmCode,
      tokens.group_id,
      tokens.device_type,
      tokens.device_index,
      payload?.date_time || payload?.dateTime || '',
    ].join('|');

    if (signature && signature === this.lastWebhookAlarmSignature) return;
    this.lastWebhookAlarmSignature = signature;
    this.webhookAlarmActive = true;

    await this.setCapabilityValue('diagral_alarm_triggered', true).catch(() => null);
    const alarmMode = this.getAlarmMode() || 'armed_away';
    await this.setCapabilityValue('diagral_alarm_mode', alarmMode).catch(() => null);
    await this.setCapabilityValue('diagral_alarm_mode_label', this.getAlarmModeLabel(alarmMode)).catch(() => null);
    await this.setCapabilityValue('diagral_last_sync', this.getLastSyncText()).catch(() => null);

    this.lastTriggered = true;
    await this.homey.app.triggerAlarmTriggered(this, tokens).catch(err => {
      this.error('Webhook alarm trigger failed', err);
    });
  }

  getWebhookEventType(payload = {}) {
    const explicit = String(payload?.alarm_type ?? payload?.alarmType ?? '').trim().toUpperCase();
    if (explicit) return explicit;

    const code = Number(payload?.alarm_code ?? payload?.alarmCode);
    const anomalyCodes = new Set([1301, 3301, 1137, 3137, 1355, 3355, 1381, 3381, 1144, 3144, 1302, 1384, 1570, 3570, 1352, 3352, 1351, 3351, 1573]);
    const alertCodes = new Set([1130, 1110, 1111, 1117, 1158, 1139, 1344, 1120, 1122, 1159, 1152, 1154, 1150, 1140, 1141, 1142, 1143, 3391, 1391]);
    const statusCodes = new Set([1306, 3401, 3407, 1401, 1407]);

    if (alertCodes.has(code)) return 'ALERT';
    if (anomalyCodes.has(code)) return 'ANOMALY';
    if (statusCodes.has(code)) return 'STATUS';
    return 'UNKNOWN';
  }

  isIntrusionWebhook(payload = {}) {
    const code = Number(payload?.alarm_code ?? payload?.alarmCode);
    if ([1130, 1139, 1141].includes(code)) return true;

    const text = String(
      payload?.alarm_description ??
      payload?.alarmDescription ??
      ''
    ).toLowerCase();

    return text.includes('intrusion') || text.includes('intrusione');
  }

  isDisarmWebhook(payload = {}) {
    const code = Number(payload?.alarm_code ?? payload?.alarmCode);
    if ([1401, 1407].includes(code)) return true;

    const text = String(
      payload?.alarm_description ??
      payload?.alarmDescription ??
      ''
    ).toLowerCase();

    return text.includes('disarming') || text.includes('spento') || text.includes('disarmo');
  }

  async getWebhookAlarmTokens(payload = {}) {
    const groupMap = await this.getGroupNameMap().catch(() => new Map());
    const detail = payload?.detail || {};
    const rawGroupId = String(payload?.group_index ?? payload?.groupIndex ?? '').trim();
    const groupId = this.normalizeWebhookGroupId(rawGroupId, groupMap);
    const deviceType = String(detail?.device_type ?? detail?.deviceType ?? '').trim();
    const deviceIndex = String(detail?.device_index ?? detail?.deviceIndex ?? '').trim();
    const deviceLabel = String(detail?.device_label ?? detail?.deviceLabel ?? '').trim();
    const alarmDescription = String(payload?.alarm_description ?? payload?.alarmDescription ?? '').trim();
    const alarmCode = String(payload?.alarm_code ?? payload?.alarmCode ?? '').trim();

    return {
      group_id: groupId,
      group_name: groupId ? (groupMap.get(Number(groupId)) || '') : '',
      alarm_code: alarmCode,
      alarm_description: alarmDescription,
      device_type: deviceType,
      device_index: deviceIndex,
      device_label: deviceLabel,
    };
  }

  normalizeWebhookGroupId(rawGroupId, groupMap = new Map()) {
    const value = String(rawGroupId || '').trim();
    if (!value || value === 'ALL_GROUP_CODE') return '';

    const numeric = Number(value);
    if (Number.isFinite(numeric) && groupMap.has(numeric)) {
      return String(numeric);
    }

    return '';
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
    const syncTask = this.syncQueue
      .catch(() => null)
      .then(() => this.syncNowUnsafe(settings));

    this.syncQueue = syncTask.catch(() => null);
    return syncTask;
  }

  async syncNowUnsafe(settings = this.getSettings()) {
    const readySettings = await this.ensureApiBootstrap(settings);
    this.rebuildClient(readySettings);

    try {
      return await this.fetchAndApplyState();
    } catch (err) {
      if (!this.isRecoverableApiKeyError(err)) {
        throw err;
      }

      this.error('Signed Diagral call failed, regenerating API keys', err);
      await this.clearStoredApiKeys();
      const recoveredSettings = await this.ensureApiBootstrap({
        ...readySettings,
        apiKey: '',
        secretKey: '',
      });
      this.rebuildClient(recoveredSettings);
      return this.fetchAndApplyState();
    }
  }

  async fetchAndApplyState() {
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

  isRecoverableApiKeyError(err) {
    const message = String(err && err.message ? err.message : err || '');
    return message.includes('HTTP 401') ||
      message.includes('Invalid HMAC signature') ||
      message.includes('Missing signature') ||
      message.includes('Missing API key or secret key');
  }

  async clearStoredApiKeys() {
    await this.setStoreValue('apiKey', '').catch(() => null);
    await this.setStoreValue('secretKey', '').catch(() => null);
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
        this.pollFailures = 0;
      } catch (err) {
        this.pollFailures += 1;
        this.error('Polling failed', err);
        if (this.pollFailures >= 3 || this.isRecoverableApiKeyError(err)) {
          await this.setUnavailable(DiagralClient.normalizeError(err)).catch(() => null);
        }
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
      if (changedKeys.some(key => ['webhookId', 'webhookSecret'].includes(key))) {
        await this.registerDiagralWebhookIfAvailable();
      }
      return true;
    } catch (err) {
      this.error('Refresh after settings failed', err);
      throw new Error(DiagralClient.normalizeError(err));
    }
  }

  async repairWithSettings(newSettings = {}) {
    const merged = {
      ...this.getSettings(),
      ...newSettings,
      apiKey: '',
      secretKey: '',
    };

    await this.stopPolling();
    await this.clearStoredApiKeys();
    const readySettings = await this.ensureApiBootstrap(merged);
    await this.setSettings({
      username: readySettings.username || '',
      password: readySettings.password || '',
      serialId: readySettings.serialId || '',
      pinCode: readySettings.pinCode || '',
      webhookId: readySettings.webhookId || '',
      webhookSecret: readySettings.webhookSecret || '',
      pollInterval: Number(readySettings.pollInterval || 180),
    });
    this.rebuildClient(readySettings);
    await this.bootstrapState(readySettings);
    this.startPolling();
    return true;
  }

  async onDeleted() {
    this.stopPolling();
  }
}

module.exports = AlarmHubDevice;
