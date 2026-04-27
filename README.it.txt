Diagral per Homey Pro ti permette di controllare il tuo sistema di allarme Diagral da Homey.

Puoi attivare e disattivare l'allarme, monitorare la modalità allarme, i gruppi attivi e le anomalie, ricevere eventi di allarme scattato, usare trigger Flow dedicati e controllare singoli gruppi dai Flow.

Configurazione:
Aggiungi il dispositivo Allarme Diagral in Homey, poi apri le Impostazioni avanzate e inserisci email Diagral eOne, password, Serial ID della centrale DIAG56AAX e codice PIN.

Prima di salvare, assicurati che non ci siano altre connessioni attive al Cloud Diagral, inclusa l'app mobile Diagral eOne.

Notifiche allarme in tempo reale opzionali:
Questa app può ricevere gli eventi di allarme Diagral tramite un webhook Homey. Questa funzione è utile per la scheda Flow "Allarme scattato", perché gli eventi webhook sono di solito più rapidi e precisi del polling.

Per abilitarla:
1. Apri Homey Developer Tools e crea un nuovo webhook.
2. Usa la strategia di matching Query Parameter.
3. Copia i valori WEBHOOK_ID e WEBHOOK_SECRET generati.
4. In Homey, apri il dispositivo Allarme Diagral, vai in Impostazioni avanzate e incolla i valori nei campi Webhook ID e Webhook secret.
5. Salva le impostazioni. L'app registrerà automaticamente l'URL del webhook su Diagral.

Mantieni WEBHOOK_ID e WEBHOOK_SECRET privati. Sono salvati nelle impostazioni del dispositivo su Homey e non devono essere pubblicati su GitHub o condivisi pubblicamente.
