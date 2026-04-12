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
          pollInterval: 180,
        },
        store: {},
      }];
    });
  }
}

module.exports = AlarmHubDriver;
