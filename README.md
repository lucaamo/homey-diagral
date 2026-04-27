# Diagral for Homey Pro

Connect your Diagral alarm system to Homey Pro.

This app lets you control the alarm, read its current status, monitor anomalies, control individual groups, and use Homey Flow cards to automate actions when the alarm changes state.

## Features

- Arm and disarm the alarm from Homey
- Check the current alarm mode
- Monitor active groups
- Monitor anomalies
- Receive real-time alarm-triggered events through a Homey webhook
- Arm or disarm individual groups from Flows
- Use dedicated Flow triggers for:
  - alarm turned off
  - alarm armed partial
  - alarm armed full
  - alarm triggered
  - active groups changed
- Automatically generate API credentials from your Diagral account

## Installation

1. Install the app on Homey Pro.
2. Add the **Diagral Alarm** device.
3. Open the device **Advanced Settings**.
4. Enter:
   - the email address used for your Diagral eOne account
   - your account password
   - the Serial ID of your Diagral alarm and control box DIAG56AAX
   - the PIN code linked to your account
5. Optional: enter your Homey webhook values:
   - WEBHOOK_ID
   - WEBHOOK_SECRET
6. Save the settings.
7. Restart the app if needed.

Before saving, make sure there are no other active connections to the Diagral Cloud, including the Diagral eOne mobile app.

## Optional Homey webhook

The app can receive alarm events from Diagral through a Homey webhook. This is especially useful for the **Alarm triggered** Flow card, because webhook events are usually faster and more precise than polling.

To enable webhook events:

1. Open Homey Developer Tools and create a new webhook.
2. Use the **Query Parameter** matching strategy.
3. Copy the generated `WEBHOOK_ID` and `WEBHOOK_SECRET`.
4. In Homey, open the **Diagral Alarm** device.
5. Go to **Advanced Settings**.
6. Paste the values into **Webhook ID** and **Webhook secret**.
7. Save the settings.

The app will automatically register the Homey webhook URL with Diagral.

Keep `WEBHOOK_ID` and `WEBHOOK_SECRET` private. They are stored in the Homey device settings and must not be committed to GitHub or shared publicly.

## Flow cards

### Triggers

- Alarm turned off
- Alarm armed partial
- Alarm armed full
- Alarm triggered
- Active groups changed

### Condition

- Alarm mode is...

### Actions

- Set alarm mode
- Set group state
- Refresh alarm status

## Notes

Use the Serial ID of your Diagral alarm and control box DIAG56AAX.

The Serial ID is a 14-character code located inside the box, on the label next to the QR code.

![How to find the Diagral box Serial ID](docs/images/diagral-serial-id.png)

## Support

- Issues: https://github.com/lucaamo/homey-diagral/issues
- Source: https://github.com/lucaamo/homey-diagral
