'use strict';

const Homey = require('homey');

class AlarmHubDriver extends Homey.Driver {
  async onInit() {
    this.log('AlarmHubDriver initialized');
  }

  async onPair(session) {
    this.log('onPair called');

    session.setHandler('list_devices', async () => {
      this.log('list_devices called');

      return [{
        name: 'Diagral Alarm',
        data: {
          id: 'diagral-default',
        },
        settings: {
          username: '',
          password: '',
          serialId: '',
          pinCode: '',
          webhookId: '',
          webhookSecret: '',
          pollInterval: 180,
        },
        store: {},
      }];
    });
  }

  async onRepair(session, device) {
    this.log('onRepair called');

    session.setHandler('get_settings', async () => {
      const settings = device.getSettings();
      return {
        username: settings.username || '',
        serialId: settings.serialId || '',
        webhookId: settings.webhookId || '',
        pollInterval: Number(settings.pollInterval || 180),
      };
    });

    session.setHandler('repair_credentials', async data => {
      const currentSettings = device.getSettings();
      await device.repairWithSettings({
        username: String(data?.username || '').trim(),
        password: String(data?.password || ''),
        serialId: String(data?.serialId || '').trim(),
        pinCode: String(data?.pinCode || '').trim(),
        webhookId: String(data?.webhookId || '').trim(),
        webhookSecret: String(data?.webhookSecret || currentSettings.webhookSecret || '').trim(),
        pollInterval: Number(data?.pollInterval || 180),
      });

      return { ok: true };
    });
  }
}

module.exports = AlarmHubDriver;
