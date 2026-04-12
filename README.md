# Diagral for Homey Pro

Stable package with:
- reduced logs
- better error messages
- configurable polling
- custom Flow cards
- working Diagral cloud API client

## Install

1. `npm install`
2. `homey app install`
3. Add device: **Diagral Alarm**
4. Fill in Email/Password + Serial ID + PIN
5. Optionally paste API key and Secret key
6. `homey app run` for development

## Flow cards

### Trigger
- Alarm mode changed
- Alarm triggered

### Condition
- Alarm mode is...

### Action
- Set alarm mode
- Refresh alarm status

## Notes

Use the Diagral box serial ID (14 chars). If you exposed credentials during testing, rotate password, PIN, API key and Secret key.
