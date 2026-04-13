'use strict';

const Homey = require('homey');

class DiagralApp extends Homey.App {
  async onInit() {
    this.log('Diagral app initialized');

    this._alarmTriggeredFlowTrigger = this.homey.flow.getDeviceTriggerCard('alarm_triggered');
    this._alarmDisarmedTrigger = this.homey.flow.getDeviceTriggerCard('alarm_disarmed');
    this._alarmArmedHomeTrigger = this.homey.flow.getDeviceTriggerCard('alarm_armed_home');
    this._alarmArmedAwayTrigger = this.homey.flow.getDeviceTriggerCard('alarm_armed_away');

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

    const syncStatus = this.homey.flow.getActionCard('sync_status');
    syncStatus.registerRunListener(async ({ device }) => {
      await device.syncNow();
      return true;
    });

    const isAlarmMode = this.homey.flow.getConditionCard('is_alarm_mode');
    isAlarmMode.registerRunListener(async ({ device, mode }) => {
      return device.getAlarmMode() === mode;
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
}

module.exports = DiagralApp;
