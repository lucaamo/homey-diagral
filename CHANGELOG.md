# Changelog

## 1.1.11

### English

- Added optional Homey webhook support for real-time Diagral alarm events.
- Added `Webhook ID` and `Webhook secret` fields in the device settings, so each user can configure their own private Homey webhook.
- Added a repair/settings page to update Diagral credentials and webhook values without removing the device.
- Improved the `Alarm triggered` Flow card with alarm description, group and sensor tokens.
- Reduced duplicate Flow triggers by serializing status updates and firing state-change events only when the alarm mode actually changes.
- Added a read-only `Alarm status` indicator for Homey Web, so the current alarm mode can be selected as a status indicator on desktop.
- Updated English and Italian setup instructions.

### Italiano

- Aggiunto il supporto opzionale ai webhook Homey per ricevere in tempo reale gli eventi di allarme Diagral.
- Aggiunti i campi `Webhook ID` e `Webhook secret` nelle impostazioni del dispositivo, così ogni utente può configurare il proprio webhook Homey privato.
- Aggiunta una pagina di riparazione/impostazioni per aggiornare credenziali Diagral e valori webhook senza rimuovere il dispositivo.
- Migliorata la scheda Flow `Allarme scattato` con token per descrizione allarme, gruppo e sensore.
- Ridotti i trigger Flow duplicati serializzando gli aggiornamenti di stato e attivando gli eventi di cambio stato solo quando la modalità dell'allarme cambia davvero.
- Aggiunto l'indicatore read-only `Stato allarme` per Homey Web, così la modalità attuale dell'allarme può essere selezionata come indicatore di stato da desktop.
- Aggiornate le istruzioni di configurazione in italiano e inglese.
