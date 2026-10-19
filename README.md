# Vice Amsterdam — backend (gratis tijdslot + Stripe-betaling)

Dit is een kleine Flask-server die bijhoudt hoe lang iemand gratis heeft
gespeeld, en na 30 minuten een eenmalige betaling van €5 via Stripe afdwingt.
Na betaling blijft het spel voor altijd ontgrendeld op dat toestel.

## 1. Bestanden op je VPS zetten

Zet de hele `backend/` map op je server, bijvoorbeeld in `/opt/vice-amsterdam/`.

```bash
cd /opt/vice-amsterdam
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 2. .env instellen

```bash
cp .env.example .env
nano .env
```

Vul in:
- `STRIPE_SECRET_KEY` — je live secret key (sk_live_...) uit het Stripe
  dashboard, **niet** de publishable key.
- `STRIPE_WEBHOOK_SECRET` — zie stap 4 hieronder, krijg je pas als je het
  webhook-endpoint hebt aangemaakt in Stripe.
- `SUCCESS_URL` / `CANCEL_URL` — waar de speler op je site het spel speelt,
  bijvoorbeeld `https://abelsoftware123.com/vice-amsterdam/?paid=1` en
  `https://abelsoftware123.com/vice-amsterdam/`.
- `ALLOWED_ORIGIN` — je site-domein, voor CORS.

**Zet `.env` nooit in git en deel het nooit — het bevat je live secret key.**

## 3. Server draaien (met gunicorn + nginx)

Test eerst lokaal:
```bash
python3 app.py
# luistert op http://0.0.0.0:5000
```

Voor productie, draai via gunicorn:
```bash
gunicorn -w 2 -b 127.0.0.1:5000 app:app
```

Zet er een systemd-service omheen zodat hij blijft draaien na een reboot
(voorbeeld `vice-amsterdam.service`):
```ini
[Unit]
Description=Vice Amsterdam backend
After=network.target

[Service]
WorkingDirectory=/opt/vice-amsterdam
Environment="PATH=/opt/vice-amsterdam/venv/bin"
ExecStart=/opt/vice-amsterdam/venv/bin/gunicorn -w 2 -b 127.0.0.1:5000 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now vice-amsterdam
```

En een nginx reverse proxy zodat `api.abelsoftware123.com` naar poort 5000
wijst, met HTTPS (bv. via certbot/Let's Encrypt — Stripe webhooks *vereisen*
HTTPS):
```nginx
server {
    server_name api.abelsoftware123.com;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 4. Stripe webhook instellen

1. Ga naar Stripe Dashboard → Developers → Webhooks → "Add endpoint"
2. URL: `https://api.abelsoftware123.com/api/webhook`
3. Event om te selecteren: `checkout.session.completed`
4. Na aanmaken zie je de **signing secret** (whsec_...) — zet die in `.env`
   als `STRIPE_WEBHOOK_SECRET` en herstart de service.

Test de webhook met de Stripe CLI voordat je live gaat:
```bash
stripe listen --forward-to https://api.abelsoftware123.com/api/webhook
stripe trigger checkout.session.completed
```

## 5. Frontend koppelen

In `index.html` staat:
```html
<script>
  window.VICE_AMSTERDAM_API_BASE = "https://api.abelsoftware123.com";
</script>
```
Zet dit op de juiste URL van je backend.

## Hoe het werkt (kort)

- Elke speler krijgt een willekeurig `device_token`, opgeslagen in
  `localStorage` van de browser.
- Bij het starten van het spel registreert de browser dit token bij de
  server (`/api/session/start`). De server slaat op *wanneer* dat voor het
  eerst gebeurde — dat tijdstip staat vast, dus de klok resetten door de
  pagina te verversen werkt niet.
- Na 30 minuten (servertijd, niet client-tijd) toont het spel de betaalmodal.
- Bij klikken op "Nu kopen" maakt de server een Stripe Checkout Session aan
  en stuurt de speler naar Stripe's eigen betaalpagina (dus geen
  creditcardgegevens die ooit jouw server raken).
- Zodra Stripe de betaling bevestigt, stuurt Stripe zelf (niet de browser!)
  een webhook naar jouw server. Pas dán wordt `paid = 1` gezet in de
  database. Dit is bewust zo gebouwd: een gebruiker kan nooit via de browser
  zelf claimen "ik heb betaald" — alleen Stripe kan dat bevestigen.

## Belangrijke kanttekening: geen waterdichte bescherming

Dit systeem koppelt betaling aan een `localStorage`-token, niet aan een
echt account met login. Dat betekent:
- Cache/localStorage wissen of een andere browser gebruiken = weer 30 min
  gratis, ook na eerder betaald te hebben op dát device (het is geen account,
  dus geen manier om in te loggen en je aankoop terug te halen op een nieuw
  device).
- Voor €5 content is dit in de praktijk gangbaar en acceptabel, maar als je
  dit wilt verstevigen is de volgende stap een echt account-systeem
  (e-mail + wachtwoord, of magic link), zodat een aankoop gekoppeld is aan
  een persoon in plaats van een device.
