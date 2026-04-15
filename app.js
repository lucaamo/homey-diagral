'use strict';

const Homey = require('homey');

class DiagralApp extends Homey.App {
  async onInit() {
    this.log('Diagral app initialized');

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
  }

  async triggerAlarmTriggered(device, tokens = {}) {
    if (!this._alarmTriggeredFlowTrigger) return;
    await this._alarmTriggeredFlowTrigger.trigger(device, tokens);
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
