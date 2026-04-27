'use strict';

const Homey = require('homey');

class DiagralApp extends Homey.App {
  async onInit() {
    this.log('Diagral app initialized');
    this.webhookUrl = '';
    this.webhook = null;
    this.webhookId = '';
    this.webhookSecret = '';

    this._alarmTriggeredFlowTrigger = this.homey.flow.getDeviceTriggerCard('alarm_triggered');
    this._alarmDisarmedTrigger = this.homey.flow.getDeviceTriggerCard('alarm_disarmed');
    this._alarmArmedHomeTrigger = this.homey.flow.getDeviceTriggerCard('alarm_armed_home');
    this._alarmArmedAwayTrigger = this.homey.flow.getDeviceTriggerCard('alarm_armed_away');
    this._activeGroupsChangedTrigger = this.homey.flow.getDeviceTriggerCard('active_groups_changed');
    this._anomalyDetectedTrigger = this.homey.flow.getDeviceTriggerCard('anomaly_detected');
    this._anomaliesClearedTrigger = this.homey.flow.getDeviceTriggerCard('anomalies_cleared');
    this._alarmStatusChangedTrigger = this.homey.flow.getDeviceTriggerCard('alarm_status_changed');
    this._anomaliesCountChangedTrigger = this.homey.flow.getDeviceTriggerCard('anomalies_count_changed');

    const setAlarmMode = this.homey.flow.getActionCard('set_alarm_mode');
    setAlarmMode.registerRunListener(async ({ device, mode }) => {
      await device.setAlarmMode(mode);
      return true;
    });

    const setGroupState = this.homey.flow.getActionCard('set_group_state');
    setGroupState.registerRunListener(async ({ device, group, operation }) => {
      await device.setGroupState(group, operation);
      return true;
    });
    setGroupState.registerArgumentAutocompleteListener('group', async (query, { device }) => {
      return device.getGroupAutocompleteResults(query);
    });

    const setGroupsState = this.homey.flow.getActionCard('set_groups_state');
    setGroupsState.registerRunListener(async ({ device, groups, operation }) => {
      await device.setGroupsState(groups, operation);
      return true;
    });

    const setPartialMode = this.homey.flow.getActionCard('set_partial_mode');
    setPartialMode.registerRunListener(async ({ device, partial }) => {
      await device.setPartialMode(partial);
      return true;
    });

    const syncStatus = this.homey.flow.getActionCard('sync_status');
    syncStatus.registerRunListener(async ({ device }) => {
      await device.syncNow();
      return true;
    });

    const isAlarmMode = this.homey.flow.getConditionCard('is_alarm_mode');
    isAlarmMode.registerRunListener(async ({ device, mode }) => {
      return device.getAlarmMode() === mode;
    });

    const isGroupActive = this.homey.flow.getConditionCard('is_group_active');
    isGroupActive.registerRunListener(async ({ device, group }) => {
      return device.isGroupActive(group);
    });
    isGroupActive.registerArgumentAutocompleteListener('group', async (query, { device }) => {
      return device.getGroupAutocompleteResults(query);
    });

    const hasAnomalies = this.homey.flow.getConditionCard('has_anomalies');
    hasAnomalies.registerRunListener(async ({ device }) => {
      return device.hasAnomalies();
    });

    const isAlarmTriggered = this.homey.flow.getConditionCard('is_alarm_triggered');
    isAlarmTriggered.registerRunListener(async ({ device }) => {
      return device.isAlarmTriggered();
    });

    await this.initCloudWebhook(Homey.env.WEBHOOK_ID, Homey.env.WEBHOOK_SECRET);
  }

  async initCloudWebhook(webhookId, webhookSecret) {
    webhookId = String(webhookId || '').trim();
    webhookSecret = String(webhookSecret || '').trim();

    if (!webhookId || !webhookSecret) {
      this.log('Diagral cloud webhook disabled: WEBHOOK_ID or WEBHOOK_SECRET missing');
      return;
    }

    if (this.webhook && this.webhookId === webhookId && this.webhookSecret === webhookSecret && this.webhookUrl) {
      return;
    }

    try {
      const homeyId = await this.homey.cloud.getHomeyId();
      this.webhookUrl = `https://webhooks.athom.com/webhook/${webhookId}/?homey=${encodeURIComponent(homeyId)}`;
      this.webhook = await this.homey.cloud.createWebhook(webhookId, webhookSecret, {});
      this.webhook.on('message', async args => {
        await this.handleDiagralWebhookMessage(args).catch(err => {
          this.error('Diagral webhook handling failed', err);
        });
      });
      this.webhookId = webhookId;
      this.webhookSecret = webhookSecret;
      this.log('Diagral cloud webhook initialized');
    } catch (err) {
      this.error('Diagral cloud webhook initialization failed', err);
    }
  }

  async getDiagralWebhookUrl(settings = {}) {
    const webhookId = settings.webhookId || Homey.env.WEBHOOK_ID;
    const webhookSecret = settings.webhookSecret || Homey.env.WEBHOOK_SECRET;

    await this.initCloudWebhook(webhookId, webhookSecret);
    return this.webhookUrl || '';
  }

  async handleDiagralWebhookMessage(args = {}) {
    const payload = this.getWebhookPayload(args);
    this.log('Diagral webhook received', this.summarizeWebhookPayload(payload));

    const driver = this.homey.drivers.getDriver('alarm_hub');
    const devices = driver.getDevices();
    const transmitterId = String(payload?.transmitter_id || payload?.transmitterId || '').trim();
    const target = devices.find(device => {
      const settings = device.getSettings();
      return String(settings.serialId || '').trim() === transmitterId;
    }) || devices[0];

    if (!target || typeof target.handleDiagralWebhook !== 'function') {
      this.error('No Diagral device available for webhook');
      return;
    }

    await target.handleDiagralWebhook(payload);
  }

  getWebhookPayload(args = {}) {
    const candidates = [
      args.body,
      args.json,
      args.data,
      args.payload,
      args,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (typeof candidate === 'object') return candidate;
      if (typeof candidate === 'string') {
        try {
          return JSON.parse(candidate);
        } catch (err) {
          continue;
        }
      }
    }

    return {};
  }

  summarizeWebhookPayload(payload = {}) {
    return {
      transmitter_id: payload.transmitter_id || payload.transmitterId || '',
      alarm_type: payload.alarm_type || payload.alarmType || '',
      alarm_code: payload.alarm_code || payload.alarmCode || '',
      alarm_description: payload.alarm_description || payload.alarmDescription || '',
      group_index: payload.group_index || payload.groupIndex || '',
      detail: payload.detail || {},
    };
  }

  async triggerAlarmTriggered(device, tokens = {}) {
    if (!this._alarmTriggeredFlowTrigger) return;
    await this._alarmTriggeredFlowTrigger.trigger(device, tokens);
    await this.notifyAlarmTriggered(device, tokens);
  }

  async notifyAlarmTriggered(device, tokens = {}) {
    try {
      if (!this.homey.notifications || typeof this.homey.notifications.createNotification !== 'function') {
        return;
      }

      const deviceName = typeof device.getName === 'function' ? device.getName() : 'Diagral';
      const detail = tokens.device_label ||
        tokens.alarm_description ||
        tokens.group_name ||
        (tokens.group_id ? `Gruppo ${tokens.group_id}` : '');
      const suffix = detail ? ` (${detail})` : '';
      await this.homey.notifications.createNotification({
        excerpt: `Allarme Diagral scattato: ${deviceName}${suffix}`,
      });
    } catch (err) {
      this.error('Failed to create alarm notification', err);
    }
  }

  async triggerAlarmDisarmed(device) {
    if (!this._alarmDisarmedTrigger) return;
    await this._alarmDisarmedTrigger.trigger(device);
  }

  async triggerAlarmArmedHome(device) {
    if (!this._alarmArmedHomeTrigger) return;
    await this._alarmArmedHomeTrigger.trigger(device);
  }

  async triggerAlarmArmedAway(device) {
    if (!this._alarmArmedAwayTrigger) return;
    await this._alarmArmedAwayTrigger.trigger(device);
  }

  async triggerActiveGroupsChanged(device, tokens = {}) {
    if (!this._activeGroupsChangedTrigger) return;
    await this._activeGroupsChangedTrigger.trigger(device, tokens);
  }

  async triggerAnomalyDetected(device, tokens = {}) {
    if (!this._anomalyDetectedTrigger) return;
    await this._anomalyDetectedTrigger.trigger(device, tokens);
  }

  async triggerAnomaliesCleared(device, tokens = {}) {
    if (!this._anomaliesClearedTrigger) return;
    await this._anomaliesClearedTrigger.trigger(device, tokens);
  }

  async triggerAlarmStatusChanged(device, tokens = {}) {
    if (!this._alarmStatusChangedTrigger) return;
    await this._alarmStatusChangedTrigger.trigger(device, tokens);
  }

  async triggerAnomaliesCountChanged(device, tokens = {}) {
    if (!this._anomaliesCountChangedTrigger) return;
    await this._anomaliesCountChangedTrigger.trigger(device, tokens);
  }
}

module.exports = DiagralApp;
