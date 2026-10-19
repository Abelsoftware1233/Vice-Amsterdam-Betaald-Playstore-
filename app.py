"""
Vice Amsterdam — backend voor gratis tijdslot + Stripe-betaling.

Werking:
- Elke speler krijgt een random device_token (gegenereerd door de browser,
  opgeslagen in localStorage EN gestuurd naar deze server).
- /api/session/start  -> registreert wanneer het gratis tijdslot begint (server-tijd,
                          dus niet te omzeilen door de klok van de telefoon te verzetten)
- /api/session/status -> vertelt de browser: nog gratis tijd over? al betaald?
- /api/checkout       -> maakt een Stripe Checkout Session aan voor de eenmalige
                          betaling van €5 en stuurt de speler naar Stripe
- /api/webhook        -> ontvangt het "betaling gelukt"-bericht van Stripe
                          (dit is de ENIGE plek waar "betaald" echt op true gezet
                          wordt — nooit vanuit de browser zelf, anders is het
                          triviaal te vervalsen)

Zet onderstaande omgevingsvariabelen in een .env bestand naast dit script
(zie .env.example) voordat je de server start.
"""

import os
import sqlite3
import time
import uuid
from contextlib import closing

from flask import Flask, request, jsonify, g
from flask_cors import CORS
import stripe
from dotenv import load_dotenv

load_dotenv()

STRIPE_SECRET_KEY = os.environ["STRIPE_SECRET_KEY"]          # sk_live_... (NOOIT in frontend code!)
STRIPE_WEBHOOK_SECRET = os.environ["STRIPE_WEBHOOK_SECRET"]  # whsec_...
PRICE_EUR_CENTS = int(os.environ.get("PRICE_EUR_CENTS", "500"))  # 500 = €5,00
FREE_MINUTES = int(os.environ.get("FREE_MINUTES", "30"))
# De URL's waar Stripe de speler na betalen/annuleren naartoe stuurt
SUCCESS_URL = os.environ["SUCCESS_URL"]  # bv. https://abelsoftware123.com/vice-amsterdam/?paid=1
CANCEL_URL = os.environ["CANCEL_URL"]    # bv. https://abelsoftware123.com/vice-amsterdam/
# Sta alleen requests van je eigen site toe
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://abelsoftware123.com")

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "players.db"))

stripe.api_key = STRIPE_SECRET_KEY

app = Flask(__name__)
CORS(app, origins=[ALLOWED_ORIGIN], supports_credentials=False)


# -----------------------------------------------------------------
# Database
# -----------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with closing(sqlite3.connect(DB_PATH)) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS players (
                device_token TEXT PRIMARY KEY,
                first_seen_at INTEGER NOT NULL,
                paid INTEGER NOT NULL DEFAULT 0,
                paid_at INTEGER,
                stripe_session_id TEXT,
                stripe_payment_intent TEXT
            )
        """)
        db.commit()


init_db()


# -----------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------
def get_or_create_player(device_token):
    db = get_db()
    row = db.execute(
        "SELECT * FROM players WHERE device_token = ?", (device_token,)
    ).fetchone()
    if row is None:
        now = int(time.time())
        db.execute(
            "INSERT INTO players (device_token, first_seen_at, paid) VALUES (?, ?, 0)",
            (device_token, now),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM players WHERE device_token = ?", (device_token,)
        ).fetchone()
    return row


def require_device_token(payload):
    token = (payload or {}).get("device_token", "")
    # device_token komt uit de browser (localStorage) — valideer alleen het formaat,
    # vertrouw niet op de inhoud verder dan "is dit een geldig uuid"
    try:
        uuid.UUID(token)
    except (ValueError, AttributeError):
        return None
    return token


# -----------------------------------------------------------------
# Routes
# -----------------------------------------------------------------
@app.route("/api/session/start", methods=["POST"])
def session_start():
    """Wordt aangeroepen de eerste keer dat iemand het spel opent op dit device.
    Idempotent: als er al een first_seen_at is, blijft die staan (anders kun je
    de gratis tijd resetten door simpelweg opnieuw te 'starten')."""
    payload = request.get_json(silent=True) or {}
    token = require_device_token(payload)
    if not token:
        return jsonify(error="invalid device_token"), 400

    player = get_or_create_player(token)
    return jsonify(status_payload(player))


@app.route("/api/session/status", methods=["POST"])
def session_status():
    payload = request.get_json(silent=True) or {}
    token = require_device_token(payload)
    if not token:
        return jsonify(error="invalid device_token"), 400

    player = get_or_create_player(token)
    return jsonify(status_payload(player))


def status_payload(player):
    now = int(time.time())
    elapsed = now - player["first_seen_at"]
    free_seconds_total = FREE_MINUTES * 60
    seconds_left = max(0, free_seconds_total - elapsed)
    paid = bool(player["paid"])
    return {
        "paid": paid,
        "free_seconds_left": seconds_left if not paid else None,
        "unlocked": paid or seconds_left > 0,
        "price_eur_cents": PRICE_EUR_CENTS,
    }


@app.route("/api/checkout", methods=["POST"])
def create_checkout():
    """Maakt een Stripe Checkout Session aan voor de eenmalige aankoop."""
    payload = request.get_json(silent=True) or {}
    token = require_device_token(payload)
    if not token:
        return jsonify(error="invalid device_token"), 400

    get_or_create_player(token)  # zorg dat de speler bestaat

    try:
        checkout_session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card", "ideal"],
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {"name": "Vice Amsterdam — volledige toegang"},
                    "unit_amount": PRICE_EUR_CENTS,
                },
                "quantity": 1,
            }],
            # device_token gaat mee als metadata, zodat de webhook weet
            # wie er betaald heeft
            metadata={"device_token": token},
            success_url=SUCCESS_URL,
            cancel_url=CANCEL_URL,
        )
    except stripe.error.StripeError as e:
        return jsonify(error=str(e)), 400

    return jsonify(checkout_url=checkout_session.url)


@app.route("/api/webhook", methods=["POST"])
def stripe_webhook():
    """Stripe roept dit aan ZELF, niet de browser. Dit is de enige plek
    waar 'paid' op 1 gezet wordt — daarom staat dit los van wat de
    gebruiker in de browser kan aanpassen."""
    payload = request.data
    sig_header = request.headers.get("Stripe-Signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
    except (ValueError, stripe.error.SignatureVerificationError):
        return jsonify(error="invalid signature"), 400

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        token = (session.get("metadata") or {}).get("device_token")
        if token:
            db = get_db()
            db.execute(
                """UPDATE players
                   SET paid = 1, paid_at = ?, stripe_session_id = ?, stripe_payment_intent = ?
                   WHERE device_token = ?""",
                (int(time.time()), session.get("id"), session.get("payment_intent"), token),
            )
            db.commit()

    return jsonify(received=True)


if __name__ == "__main__":
    # Voor lokaal testen. Op je VPS: draai dit achter gunicorn + nginx (zie README).
    app.run(host="0.0.0.0", port=9988, debug=False)
