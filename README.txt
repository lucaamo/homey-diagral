Diagral for Homey Pro lets you control your Diagral alarm system from Homey.

You can arm and disarm the alarm, monitor alarm mode, active groups and anomalies, receive alarm-triggered events, use dedicated Flow triggers, and control individual groups from Flows.

Setup:
Add the Diagral Alarm device in Homey, then open Advanced Settings and enter your Diagral eOne email, password, the Serial ID of the DIAG56AAX alarm and control box, and your PIN code.

Before saving, make sure there are no other active connections to the Diagral Cloud, including the Diagral eOne mobile app.

Optional real-time alarm notifications:
This app can also receive Diagral alarm events through a Homey webhook. This is useful for the "Alarm triggered" Flow card, because webhook events are usually faster and more precise than polling.

To enable this feature:
1. Open Homey Developer Tools and create a new webhook.
2. Use the Query Parameter matching strategy.
3. Copy the generated WEBHOOK_ID and WEBHOOK_SECRET.
4. In Homey, open the Diagral Alarm device, go to Advanced Settings, and paste the values into Webhook ID and Webhook secret.
5. Save the settings. The app will register the webhook URL with Diagral automatically.

Keep WEBHOOK_ID and WEBHOOK_SECRET private. They are stored in your Homey device settings and must not be committed to GitHub or shared publicly.
