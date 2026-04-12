'use strict';

const Homey = require('homey');

class DiagralApp extends Homey.App {
  async onInit() {
    this.log('Diagral app initialized');
    this.registerFlowCards();
  }

  registerFlowCards() {
    this._alarmModeChangedTrigger = this.homey.flow.getDeviceTriggerCard('alarm_mode_changed');

    this._alarmModeChangedTrigger.registerRunListener(async (args, state) => {
      return args && state && args.mode === state.mode;
    });

    const setAlarmMode = this.homey.flow.getActionCard('set_alarm_mode');
    setAlarmMode.registerRunListener(async ({ device, mode }) => {
      await device.setAlarmMode(mode);
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

  async triggerModeChanged(device, mode) {
    if (!this._alarmModeChangedTrigger) return;
    await this._alarmModeChangedTrigger.trigger(device, { mode }, { mode });
  }
}

module.exports = DiagralApp;
