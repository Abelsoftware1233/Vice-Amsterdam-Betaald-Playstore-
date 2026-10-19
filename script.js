/* ===========================================================
   VICE AMSTERDAM
   Origineel top-down actiespel. Fictieve stad, fictief verhaal,
   fictief personage (Karimo). Geen bestaande merken of IP.
   =========================================================== */

(() => {
  "use strict";

  // ---------------------------------------------------------
  // Paywall: 30 min gratis, dan eenmalige betaling via Stripe
  // ---------------------------------------------------------
  const API_BASE = window.VICE_AMSTERDAM_API_BASE || "";
  const paywallEl = document.getElementById("paywall");
  const pwBuyBtn = document.getElementById("pwBuyBtn");
  const pwError = document.getElementById("pwError");
  const pwPrice = document.getElementById("pwPrice");
  const timeChip = document.getElementById("timeChip");

  const paywall = {
    deviceToken: null,
    paid: false,
    freeSecondsLeft: null, // null = onbekend/nog niet geladen, of onbeperkt (betaald)
    unlocked: false,
    loaded: false,
  };

  function getOrCreateDeviceToken() {
    let t = localStorage.getItem("va_device_token");
    if (!t) {
      t = (crypto.randomUUID ? crypto.randomUUID() : uuidFallback());
      localStorage.setItem("va_device_token", t);
    }
    return t;
  }
  function uuidFallback() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("API-fout (" + res.status + ")");
    return res.json();
  }

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  }

  async function initPaywall() {
    paywall.deviceToken = getOrCreateDeviceToken();
    try {
      const data = await apiPost("/api/session/start", { device_token: paywall.deviceToken });
      applyStatus(data);
    } catch (e) {
      // Als de backend niet bereikbaar is, laat de speler niet in het ongewisse:
      // toon een foutmelding i.p.v. het spel stilletjes gratis open te zetten.
      pwError.textContent = "Kan geen verbinding maken met de server. Probeer het later opnieuw.";
    }
    paywall.loaded = true;
  }

  function applyStatus(data) {
    paywall.paid = !!data.paid;
    paywall.freeSecondsLeft = data.free_seconds_left;
    paywall.unlocked = !!data.unlocked;
    if (data.price_eur_cents != null) {
      pwPrice.textContent = "€ " + (data.price_eur_cents / 100).toFixed(2).replace(".", ",") + ",-";
    }
    if (paywall.paid) {
      timeChip.style.display = "none";
    } else if (paywall.freeSecondsLeft != null) {
      timeChip.style.display = "block";
      timeChip.textContent = formatTime(paywall.freeSecondsLeft);
    }
    if (!paywall.unlocked) {
      showPaywall();
    }
  }

  let lastStatusPoll = 0;
  function tickPaywallClock(dt) {
    if (!paywall.loaded || paywall.paid) return;
    if (paywall.freeSecondsLeft == null) return;
    paywall.freeSecondsLeft -= dt;
    timeChip.textContent = formatTime(paywall.freeSecondsLeft);
    if (paywall.freeSecondsLeft <= 0) {
      paywall.unlocked = false;
      showPaywall();
    }
    // Elke 20s even bij de server checken (ivm. eventuele betaling in ander tabblad)
    lastStatusPoll += dt;
    if (lastStatusPoll > 20) {
      lastStatusPoll = 0;
      apiPost("/api/session/status", { device_token: paywall.deviceToken })
        .then(applyStatus)
        .catch(() => {});
    }
  }

  function showPaywall() {
    gamePaused = true;
    paywallEl.style.display = "flex";
  }
  function hidePaywall() {
    paywallEl.style.display = "none";
    gamePaused = false;
  }

  pwBuyBtn.addEventListener("click", async () => {
    pwError.textContent = "";
    pwBuyBtn.disabled = true;
    pwBuyBtn.textContent = "Even geduld...";
    try {
      const data = await apiPost("/api/checkout", { device_token: paywall.deviceToken });
      window.location.href = data.checkout_url; // door naar Stripe Checkout
    } catch (e) {
      pwError.textContent = "Betaling starten mislukt. Probeer het opnieuw.";
      pwBuyBtn.disabled = false;
      pwBuyBtn.textContent = "Nu kopen";
    }
  });

  // Als de speler terugkomt van Stripe (success_url bevat ?paid=1), check direct de status
  function checkReturnFromStripe() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") === "1") {
      apiPost("/api/session/status", { device_token: getOrCreateDeviceToken() })
        .then((data) => { applyStatus(data); if (paywall.unlocked) hidePaywall(); })
        .catch(() => {});
    }
  }

  // ---------------------------------------------------------
  // Canvas & viewport
  // ---------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const radarCanvas = document.getElementById("radarCanvas");
  const radarCtx = radarCanvas ? radarCanvas.getContext("2d") : null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    VIEW.w = w;
    VIEW.h = h;
  }
  const VIEW = { w: 0, h: 0 };
  window.addEventListener("resize", resize);

  // ---------------------------------------------------------
  // World generation (grid city)
  // ---------------------------------------------------------
  const WORLD = {
    size: 3200,          // world is WORLD.size x WORLD.size
    blockSize: 220,
    roadWidth: 64,
  };

  const CANAL = {
    // A couple of canal strips running through the city (visual + collision)
    strips: [
      { x: 900, w: 90, vertical: true },
      { x: 2100, w: 90, vertical: true },
      { y: 1500, h: 90, vertical: false },
    ],
  };

  const NEON_WORDS = [
    "CAFE", "BAR DE NACHT", "HOTEL", "GRAND", "CASA", "CLUB 91",
    "FRITUUR", "NEON", "DISCO", "PARKING", "APOTHEEK", "SNACK",
  ];

  const BUILDINGS = [];
  (function generateBuildings() {
    const rng = mulberry32(1991);
    const bs = WORLD.blockSize;
    const rw = WORLD.roadWidth;
    let neonIdx = 0;
    for (let bx = 0; bx < WORLD.size; bx += bs) {
      for (let by = 0; by < WORLD.size; by += bs) {
        const cx = bx + bs / 2;
        const cy = by + bs / 2;
        if (inAnyCanal(cx, cy, 130)) continue;
        const pad = rw / 2 + 14;
        const bw = bs - pad * 2 - rng() * 30;
        const bh = bs - pad * 2 - rng() * 30;
        if (bw < 40 || bh < 40) continue;
        const hue = 255 + rng() * 70;
        const roofKind = rng() < 0.5 ? "pink" : "cyan";
        const storeyH = 16 + rng() * 6;
        const storeys = Math.max(2, Math.floor((bh * 0.7) / storeyH));
        const hasAwning = rng() < 0.4;
        const hasNeon = rng() < 0.3;
        const heightTier = rng() < 0.2 ? 3 : (rng() < 0.5 ? 2 : 1); // affects shadow depth
        BUILDINGS.push({
          x: bx + pad,
          y: by + pad,
          w: bw,
          h: bh,
          baseColor: `hsl(${hue.toFixed(0)}, 36%, ${(14 + rng() * 9).toFixed(0)}%)`,
          trimColor: `hsl(${hue.toFixed(0)}, 30%, ${(9 + rng() * 6).toFixed(0)}%)`,
          roof: roofKind,
          storeys,
          storeyH,
          hasAwning,
          awningColor: rng() < 0.5 ? "#ff2e8e" : "#ffe14d",
          hasNeon,
          neonText: hasNeon ? NEON_WORDS[neonIdx++ % NEON_WORDS.length] : null,
          neonColor: rng() < 0.5 ? "#ff2e8e" : "#2ee6ff",
          heightTier,
          litWindowSeed: rng(),
        });
      }
    }
  })();

  function inAnyCanal(x, y, margin) {
    for (const s of CANAL.strips) {
      if (s.vertical) {
        if (Math.abs(x - s.x) < s.w / 2 + margin) return true;
      } else {
        if (Math.abs(y - s.y) < s.h / 2 + margin) return true;
      }
    }
    return false;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rectCollide(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + ah && ay + ah > by;
  }

  function collidesBuilding(x, y, r) {
    for (const b of BUILDINGS) {
      if (rectCollide(x - r, y - r, r * 2, r * 2, b.x, b.y, b.w, b.h)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------
  // Parked / drivable cars scattered in the world
  // ---------------------------------------------------------
  const CAR_COLORS = ["#ff2e8e", "#2ee6ff", "#ffe14d", "#8a5cff", "#ff7a3d", "#ededed"];
  const cars = [];
  (function scatterCars() {
    const rng = mulberry32(42);
    for (let i = 0; i < 46; i++) {
      let x, y, tries = 0;
      do {
        x = rng() * WORLD.size;
        y = rng() * WORLD.size;
        tries++;
      } while ((collidesBuilding(x, y, 40) || inAnyCanal(x, y, 20)) && tries < 20);
      cars.push({
        x, y,
        angle: Math.floor(rng() * 4) * (Math.PI / 2),
        color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
        w: 34, h: 18,
        speed: 0,
        occupied: false,
        isPolice: false,
      });
    }
  })();

  // ---------------------------------------------------------
  // Player: Karimo
  // ---------------------------------------------------------
  const player = {
    x: WORLD.size / 2,
    y: WORLD.size / 2 + 140,
    angle: 0,
    speed: 0,
    walkSpeed: 150,
    radius: 11,
    health: 100,
    cash: 250,
    inCar: null,
    wanted: 0,          // 0..5 stars
    alive: true,
    weapons: { fist: true, pistol: false, uzi: false },
    ammo: { pistol: 0, uzi: 0 },
    currentWeapon: "fist",
    fireCooldown: 0,
    reputation: 1,
    missionsCompleted: 0,
    spawnX: WORLD.size / 2,
    spawnY: WORLD.size / 2 + 140,
    jacketColor: "#ff2e8e",
    ownedOutfits: ["classic"],
    maxHealthBonus: 0, // from vest upgrades
    storyStage: 0,     // index into STORY_MISSIONS, how far the main story has progressed
  };

  const WEAPON_STATS = {
    fist:   { damage: 8,  range: 30,  cooldown: 0.35, isMelee: true },
    pistol: { damage: 22, range: 340, cooldown: 0.32, isMelee: false, bulletSpeed: 620 },
    uzi:    { damage: 11, range: 300, cooldown: 0.09, isMelee: false, bulletSpeed: 700 },
  };

  // Place player on a safe spot
  (function placePlayer() {
    let tries = 0;
    while (collidesBuilding(player.x, player.y, 14) && tries < 50) {
      player.x += 20; tries++;
    }
  })();

  // ---------------------------------------------------------
  // Pedestrians (ambient, can scatter when scared)
  // ---------------------------------------------------------
  const pedestrians = [];
  (function scatterPeds() {
    const rng = mulberry32(777);
    for (let i = 0; i < 28; i++) {
      let x, y, tries = 0;
      do {
        x = rng() * WORLD.size;
        y = rng() * WORLD.size;
        tries++;
      } while (collidesBuilding(x, y, 20) && tries < 20);
      pedestrians.push({
        x, y,
        angle: rng() * Math.PI * 2,
        speed: 28 + rng() * 18,
        wanderT: rng() * 3,
        scared: false,
        health: 20,
        alive: true,
        color: ["#ffb3d1", "#b3e0ff", "#fff0b3", "#c9b3ff"][Math.floor(rng() * 4)],
      });
    }
  })();

  // ---------------------------------------------------------
  // Garages & clothing shops (world locations the player walks into)
  // ---------------------------------------------------------
  const SHOP_CATALOGS = {
    garage: [
      { id: "paint_cyan", name: "Spuitwerk — Neon Cyaan", desc: "Verf je huidige auto cyaan.", price: 80, kind: "paint", value: "#2ee6ff" },
      { id: "paint_pink", name: "Spuitwerk — Neon Roze", desc: "Verf je huidige auto roze.", price: 80, kind: "paint", value: "#ff2e8e" },
      { id: "paint_gold", name: "Spuitwerk — Goud", desc: "Verf je huidige auto goud.", price: 120, kind: "paint", value: "#ffe14d" },
      { id: "engine1", name: "Motor-upgrade", desc: "Meer topsnelheid voor je huidige auto.", price: 220, kind: "engine_upgrade" },
      { id: "armor1", name: "Pantserplaten", desc: "Je huidige auto overleeft meer rammen.", price: 180, kind: "armor_upgrade" },
      { id: "vest1", name: "Kogelvrij vest", desc: "+25 max. gezondheid, permanent.", price: 300, kind: "vest" },
    ],
    clothing: [
      { id: "classic", name: "Classic roze jack", desc: "Het jack waarmee je begon.", price: 0, kind: "outfit", value: "#ff2e8e" },
      { id: "cyan_suit", name: "Cyaan pak", desc: "Netjes gestoken voor de nacht.", price: 150, kind: "outfit", value: "#2ee6ff" },
      { id: "gold_jacket", name: "Gouden jack", desc: "Opvallen is het doel.", price: 260, kind: "outfit", value: "#ffe14d" },
      { id: "black_leather", name: "Zwart leren jack", desc: "Voor als het menens wordt.", price: 200, kind: "outfit", value: "#2a1f3d" },
    ],
  };

  const shops = [];
  (function placeShops() {
    const rng = mulberry32(5150);
    const kinds = ["garage", "clothing"];
    for (let i = 0; i < 6; i++) {
      const kind = kinds[i % 2];
      const spot = randomSpotNearFn(rng, WORLD.size / 2, WORLD.size / 2, 200, 1300);
      shops.push({ x: spot.x, y: spot.y, kind, radius: 34 });
    }
  })();

  function randomSpotNearFn(rng, x, y, minD, maxD) {
    let tries = 0, px, py;
    do {
      const a = rng() * Math.PI * 2;
      const d = minD + rng() * (maxD - minD);
      px = x + Math.cos(a) * d;
      py = y + Math.sin(a) * d;
      tries++;
    } while (collidesBuilding(px, py, 30) && tries < 30);
    return { x: px, y: py };
  }

  // ---------------------------------------------------------
  // Pickups: health, weapons, cash bags
  // ---------------------------------------------------------
  const pickups = [];
  function scatterPickups() {
    const rng = mulberry32(Date.now() % 100000);
    const types = [
      { kind: "health", amount: 40 },
      { kind: "pistol_ammo", amount: 18 },
      { kind: "uzi_ammo", amount: 60 },
      { kind: "cash", amount: 0 }, // amount set randomly below
      { kind: "weapon_pistol", amount: 0 },
      { kind: "weapon_uzi", amount: 0 },
    ];
    for (let i = 0; i < 18; i++) {
      let x, y, tries = 0;
      do {
        x = rng() * WORLD.size;
        y = rng() * WORLD.size;
        tries++;
      } while ((collidesBuilding(x, y, 24) || inAnyCanal(x, y, 20)) && tries < 20);
      const t = types[Math.floor(rng() * types.length)];
      const amount = t.kind === "cash" ? Math.floor(30 + rng() * 120) : t.amount;
      pickups.push({ x, y, kind: t.kind, amount, taken: false, bob: rng() * 10 });
    }
  }
  scatterPickups();

  // ---------------------------------------------------------
  // Bullets (player + enemy)
  // ---------------------------------------------------------
  const bullets = [];

  // ---------------------------------------------------------
  // Ambient rain (screen-space, intensifies at night)
  // ---------------------------------------------------------
  const RAIN_COUNT = 70;
  const rainDrops = [];
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainDrops.push({
      x: Math.random(), y: Math.random(),
      len: 8 + Math.random() * 10,
      speed: 500 + Math.random() * 300,
    });
  }

  // ---------------------------------------------------------
  // Day / night cycle
  // ---------------------------------------------------------
  const DAY_LENGTH = 180; // seconds for a full cycle
  let worldTime = 40;      // start mid-morning-ish

  function dayNightFactor() {
    // returns 0 (full day) .. 1 (full night)
    const t = (worldTime % DAY_LENGTH) / DAY_LENGTH;
    // smooth curve: bright around t=0.25 (midday), dark around t=0.75 (midnight)
    return (1 - Math.cos(t * Math.PI * 2)) / 2 * 0.85;
  }

  // ---------------------------------------------------------
  // Simple WebAudio synth for sfx (no external samples/IP)
  // ---------------------------------------------------------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  function sfx(type) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    if (type === "shot") {
      osc.type = "square";
      osc.frequency.setValueAtTime(320, t0);
      osc.frequency.exponentialRampToValueAtTime(80, t0 + 0.08);
      gain.gain.setValueAtTime(0.18, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      osc.start(t0); osc.stop(t0 + 0.11);
    } else if (type === "punch") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(140, t0);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
      gain.gain.setValueAtTime(0.16, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
      osc.start(t0); osc.stop(t0 + 0.14);
    } else if (type === "pickup") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, t0);
      osc.frequency.exponentialRampToValueAtTime(1040, t0 + 0.12);
      gain.gain.setValueAtTime(0.14, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
      osc.start(t0); osc.stop(t0 + 0.16);
    } else if (type === "engine") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(90, t0);
      gain.gain.setValueAtTime(0.05, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
      osc.start(t0); osc.stop(t0 + 0.08);
    } else if (type === "siren") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(700, t0);
      osc.frequency.linearRampToValueAtTime(1000, t0 + 0.25);
      osc.frequency.linearRampToValueAtTime(700, t0 + 0.5);
      gain.gain.setValueAtTime(0.06, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
      osc.start(t0); osc.stop(t0 + 0.51);
    } else if (type === "mission") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, t0);
      osc.frequency.setValueAtTime(660, t0 + 0.1);
      osc.frequency.setValueAtTime(880, t0 + 0.2);
      gain.gain.setValueAtTime(0.14, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
      osc.start(t0); osc.stop(t0 + 0.36);
    }
  }

  // ---------------------------------------------------------
  // Police
  // ---------------------------------------------------------
  const police = []; // on-foot + car units chasing player when wanted > 0
  let policeSpawnTimer = 0;

  function spawnPoliceUnit() {
    // spawn at edge of current view, in world space
    const angle = Math.random() * Math.PI * 2;
    const dist = 420 + Math.random() * 120;
    const px = player.x + Math.cos(angle) * dist;
    const py = player.y + Math.sin(angle) * dist;
    police.push({
      x: px, y: py,
      angle: angle + Math.PI,
      speed: 0,
      radius: 11,
      health: 60,
      car: null, // assigned if we want police cars later
      state: "chase",
    });
  }

  // ---------------------------------------------------------
  // Missions
  // ---------------------------------------------------------
  const MISSION_DEFS = [
    {
      id: "delivery1",
      title: "Pakketje bezorgen",
      text: "Haal het pakketje op bij de markering en breng het naar de drop-zone.",
      type: "fetch-deliver",
      reward: 300,
    },
    {
      id: "race1",
      title: "Straatrace",
      text: "Rijd met een auto naar de finish voordat de tijd om is.",
      type: "race",
      reward: 400,
      timeLimit: 55,
    },
    {
      id: "escape1",
      title: "Uit het zicht blijven",
      text: "Verlies je wanted-level door 20 seconden uit het zicht van de politie te blijven.",
      type: "lose-heat",
      reward: 200,
    },
    {
      id: "taxi1",
      title: "Taxiritje",
      text: "Haal de passagier op en breng diegene naar de bestemming.",
      type: "taxi",
      reward: 250,
    },
    {
      id: "steal1",
      title: "Auto regelen",
      text: "Breng een auto naar de markering voor een klant.",
      type: "steal-car",
      reward: 350,
    },
    {
      id: "clear1",
      title: "Terrein zuiveren",
      text: "Schakel alle gemarkeerde doelen uit.",
      type: "clear-targets",
      reward: 450,
    },
  ];

  let currentMission = null;
  let missionMarker = null;   // {x,y,kind:'pickup'|'dropoff'|'finish'|'passenger'|'car-drop'}
  let missionTimer = 0;
  let missionState = "none"; // none | active | pickup-done
  let missionCooldown = 2;   // seconds before next mission can start
  let missionTargets = [];   // for clear-targets missions: {x,y,health,alive}
  let missionCarRef = null;  // for steal-car missions: which car to deliver

  // ---------------------------------------------------------
  // Story: Karimo's verhaal — 6 hoofdmissies, fictief, eigen personages
  // ---------------------------------------------------------
  const STORY_MISSIONS = [
    {
      title: "Hoofdstuk 1 — Nieuw in de stad",
      intro: [
        "Karimo stapt uit de trein met niets dan een tas en een adres op een papiertje.",
        "Amsterdam ruikt anders 's nachts. Neon, regen, en beloftes die nog niemand heeft gebroken.",
        "Een oude bekende, Vince, wacht bij de brug. Hij heeft werk — klein, om te beginnen.",
      ],
      type: "fetch-deliver",
      reward: 350,
      outro: "Vince knikt goedkeurend. 'Niet slecht. Er is meer werk als je het aankan.'",
    },
    {
      title: "Hoofdstuk 2 — Vertrouwen winnen",
      intro: [
        "Vince stelt Karimo voor aan Loes, die de garages aan de rand van de stad runt.",
        "'Breng deze auto naar haar toe. Netjes, zonder krassen — dit is een test.'",
      ],
      type: "steal-car",
      reward: 420,
      outro: "Loes bekijkt de auto van top tot teen. 'Je kunt rijden. Goed om te weten.'",
    },
    {
      title: "Hoofdstuk 3 — De race",
      intro: [
        "Er gaat een gerucht rond over een straatrace die elk weekend meer geld trekt.",
        "Vince wil dat Karimo meedoet — niet voor de eer, maar om gezien te worden.",
      ],
      type: "race",
      reward: 500,
      timeLimit: 60,
      outro: "Karimo haalt de finish. De menigte kent zijn naam nu.",
    },
    {
      title: "Hoofdstuk 4 — Onder de radar",
      intro: [
        "Iets ging mis bij de vorige klus. Er hangt nu politie rond die Karimo herkent.",
        "'Blijf uit het zicht tot het stof neerdaalt,' zegt Vince. 'Dan praten we verder.'",
      ],
      type: "lose-heat",
      reward: 380,
      outro: "De straten kalmeren. Karimo haalt adem — dit stadsleven vraagt veel.",
    },
    {
      title: "Hoofdstuk 5 — De oppositie",
      intro: [
        "Een rivaliserende groep heeft een pand ingenomen dat van Vince' mensen was.",
        "'Maak het gebied weer veilig,' zegt Vince. 'Laat zien dat we niet wegdrukken.'",
      ],
      type: "clear-targets",
      reward: 600,
      outro: "Het pand is weer vrij. Vince belt Karimo met nieuws dat alles verandert.",
    },
    {
      title: "Hoofdstuk 6 — De laatste rit",
      intro: [
        "Een belangrijk pakket moet vannacht nog de stad uit, voor het te laat is.",
        "'Dit is de grote,' zegt Vince. 'Lever het af en je naam staat vast in deze stad.'",
      ],
      type: "fetch-deliver",
      reward: 900,
      outro: "Karimo kijkt uit over de gracht terwijl de zon opkomt. Amsterdam voelt nu als thuis.",
    },
  ];
  let storyActive = false;
  let storyDialogueQueue = [];
  let awaitingStoryStart = false; // true while intro dialogue is showing, before mission actually starts

  function randomSpotNear(x, y, minD, maxD) {
    let tries = 0, px, py;
    do {
      const a = Math.random() * Math.PI * 2;
      const d = minD + Math.random() * (maxD - minD);
      px = x + Math.cos(a) * d;
      py = y + Math.sin(a) * d;
      tries++;
    } while (collidesBuilding(px, py, 20) && tries < 30);
    return { x: px, y: py };
  }

  const storyBox = document.getElementById("storyBox");
  const storyText = document.getElementById("storyText");

  function showStoryDialogue(lines, onDone) {
    storyDialogueQueue = lines.slice();
    storyBox.style.display = "block";
    gamePaused = true;
    advanceStoryDialogue(onDone);
  }
  function advanceStoryDialogue(onDone) {
    if (storyDialogueQueue.length === 0) {
      storyBox.style.display = "none";
      gamePaused = false;
      if (onDone) onDone();
      return;
    }
    storyText.textContent = storyDialogueQueue.shift();
  }
  storyBox.addEventListener("click", () => advanceStoryDialogue(storyBox._onDone));
  storyBox.addEventListener("touchstart", (e) => { e.preventDefault(); advanceStoryDialogue(storyBox._onDone); }, { passive: false });

  function showStoryDialogueTracked(lines, onDone) {
    storyBox._onDone = onDone;
    showStoryDialogue(lines, onDone);
  }

  function maybeStartStoryMission() {
    if (currentMission) return false;
    if (player.storyStage >= STORY_MISSIONS.length) return false;
    const def = STORY_MISSIONS[player.storyStage];
    storyActive = true;
    showStoryDialogueTracked(def.intro, () => {
      beginStoryMissionPlay(def);
    });
    return true;
  }

  function beginStoryMissionPlay(def) {
    currentMission = def;
    missionState = "active";
    showMissionBanner(def.title, "Hoofdverhaal");
    sfx("mission");
    setupMissionGeometryFor(def);
  }

  function setupMissionGeometryFor(def) {
    if (def.type === "fetch-deliver") {
      const pickup = randomSpotNear(player.x, player.y, 150, 500);
      missionMarker = { x: pickup.x, y: pickup.y, kind: "pickup" };
    } else if (def.type === "race") {
      const finish = randomSpotNear(player.x, player.y, 500, 900);
      missionMarker = { x: finish.x, y: finish.y, kind: "finish" };
      missionTimer = def.timeLimit;
    } else if (def.type === "lose-heat") {
      missionMarker = null;
      missionTimer = 20;
      player.wanted = Math.max(player.wanted, 2);
    } else if (def.type === "taxi") {
      const pass = randomSpotNear(player.x, player.y, 150, 450);
      missionMarker = { x: pass.x, y: pass.y, kind: "passenger" };
    } else if (def.type === "steal-car") {
      const candidates = cars.filter(c => !c.occupied);
      missionCarRef = candidates[Math.floor(Math.random() * candidates.length)] || null;
      const drop = randomSpotNear(player.x, player.y, 300, 700);
      missionMarker = { x: drop.x, y: drop.y, kind: "car-drop" };
    } else if (def.type === "clear-targets") {
      missionTargets = [];
      const count = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        const spot = randomSpotNear(player.x, player.y, 150, 550);
        missionTargets.push({ x: spot.x, y: spot.y, health: 35, alive: true, angle: Math.random() * Math.PI * 2 });
      }
      missionMarker = null;
    }
  }

  function startRandomMission() {
    // Hoofdverhaal krijgt voorrang zodra er een nieuw hoofdstuk klaarstaat
    if (player.storyStage < STORY_MISSIONS.length) {
      maybeStartStoryMission();
      return;
    }
    storyActive = false;
    const def = MISSION_DEFS[Math.floor(Math.random() * MISSION_DEFS.length)];
    currentMission = def;
    missionState = "active";
    showMissionBanner(def.title, def.text);
    sfx("mission");
    setupMissionGeometryFor(def);
  }

  function completeMission(success) {
    const wasStory = storyActive;
    const finishedDef = currentMission;

    if (success && currentMission) {
      const bonus = Math.floor(currentMission.reward * (1 + (player.reputation - 1) * 0.15));
      player.cash += bonus;
      player.missionsCompleted++;
      if (!wasStory && player.missionsCompleted % 3 === 0) {
        player.reputation++;
        flashMessage(`Missie geslaagd! +f ${bonus},- — Reputatie ${player.reputation}!`);
      } else {
        flashMessage(`Missie geslaagd! +f ${bonus},-`);
      }
      sfx("mission");
      if (wasStory) {
        player.storyStage++;
        player.reputation++;
      }
    } else if (currentMission) {
      flashMessage("Missie mislukt.");
    }
    currentMission = null;
    missionMarker = null;
    missionTargets = [];
    missionCarRef = null;
    missionState = "none";
    missionCooldown = 3 + Math.random() * 3;
    hideMissionBanner();

    if (success && wasStory && finishedDef && finishedDef.outro) {
      showStoryDialogueTracked([finishedDef.outro], null);
      missionCooldown = 6; // geef wat adempauze na een hoofdstuk
    }
    storyActive = false;
  }

  function flashMessage(text) {
    const b = document.getElementById("missionBanner");
    const t = document.getElementById("mbTitle");
    const d = document.getElementById("mbText");
    t.textContent = text;
    d.textContent = "";
    b.style.display = "block";
    clearTimeout(flashMessage._t);
    flashMessage._t = setTimeout(hideMissionBanner, 2200);
  }

  function showMissionBanner(title, text) {
    const b = document.getElementById("missionBanner");
    document.getElementById("mbTitle").textContent = title;
    document.getElementById("mbText").textContent = text;
    b.style.display = "block";
  }
  function hideMissionBanner() {
    document.getElementById("missionBanner").style.display = "none";
  }

  // ---------------------------------------------------------
  // Input: keyboard (desktop) + virtual joystick/buttons (touch)
  // ---------------------------------------------------------
  const input = {
    moveX: 0, moveY: 0, // -1..1
    gas: false,
    brake: false,
    enterPressed: false,
    fire: false,
    switchWeaponPressed: false,
  };

  const keys = {};
  window.addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  function readKeyboard() {
    let mx = 0, my = 0;
    let anyKey = false;
    if (keys["arrowleft"] || keys["a"]) { mx -= 1; anyKey = true; }
    if (keys["arrowright"] || keys["d"]) { mx += 1; anyKey = true; }
    if (keys["arrowup"] || keys["w"]) { my -= 1; anyKey = true; }
    if (keys["arrowdown"] || keys["s"]) { my += 1; anyKey = true; }
    // Alleen het toetsenbord laten bepalen als er echt een toets is ingedrukt —
    // anders overschrijft dit elke frame de virtuele joystick met (0,0) en
    // kan het poppetje op mobiel nooit lopen.
    if (anyKey || !stickActive) {
      input.moveX = mx; input.moveY = my;
    }
    input.gas = input.gas || !!keys["arrowup"] || !!keys["w"] || !!keys[" "];
    input.brake = input.brake || !!keys["arrowdown"] || !!keys["s"];
  }
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "e" || e.key.toLowerCase() === "enter") input.enterPressed = true;
  });

  // Virtual joystick
  const stickZone = document.getElementById("stickZone");
  const stickKnob = document.getElementById("stickKnob");
  let stickActive = false;
  let stickId = null;
  let stickCenter = { x: 0, y: 0 };
  const STICK_RADIUS = 52;

  function stickStart(id, cx, cy) {
    stickActive = true;
    stickId = id;
    const rect = stickZone.getBoundingClientRect();
    stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    stickMove(cx, cy);
  }
  function stickMove(cx, cy) {
    if (!stickActive) return;
    let dx = cx - stickCenter.x;
    let dy = cy - stickCenter.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_RADIUS);
    const ang = Math.atan2(dy, dx);
    const kx = Math.cos(ang) * clamped;
    const ky = Math.sin(ang) * clamped;
    stickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    input.moveX = kx / STICK_RADIUS;
    input.moveY = ky / STICK_RADIUS;
  }
  function stickEnd() {
    stickActive = false;
    stickId = null;
    stickKnob.style.transform = "translate(0,0)";
    input.moveX = 0; input.moveY = 0;
  }

  stickZone.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    stickStart(t.identifier, t.clientX, t.clientY);
  }, { passive: false });
  stickZone.addEventListener("touchmove", (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) stickMove(t.clientX, t.clientY);
    }
  }, { passive: false });
  window.addEventListener("touchend", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) stickEnd();
    }
  });
  window.addEventListener("touchcancel", stickEnd);

  // Mouse fallback for stick (desktop testing)
  stickZone.addEventListener("mousedown", (e) => { stickStart("mouse", e.clientX, e.clientY); });
  window.addEventListener("mousemove", (e) => { if (stickId === "mouse") stickMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", () => { if (stickId === "mouse") stickEnd(); });

  // Gas / brake / enter buttons
  const btnGas = document.getElementById("btnGas");
  const btnBrake = document.getElementById("btnBrake");
  const btnEnter = document.getElementById("btnEnter");

  function bindHold(el, onDown, onUp) {
    el.addEventListener("touchstart", (e) => { e.preventDefault(); onDown(); }, { passive: false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); onUp(); }, { passive: false });
    el.addEventListener("touchcancel", onUp);
    el.addEventListener("mousedown", onDown);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("mouseleave", onUp);
  }
  bindHold(btnGas, () => (input.gas = true), () => (input.gas = false));
  bindHold(btnBrake, () => (input.brake = true), () => (input.brake = false));
  btnEnter.addEventListener("touchstart", (e) => { e.preventDefault(); ensureAudio(); input.enterPressed = true; }, { passive: false });
  btnEnter.addEventListener("click", () => { ensureAudio(); input.enterPressed = true; });

  const btnFire = document.getElementById("btnFire");
  const btnSwitch = document.getElementById("btnSwitch");
  bindHold(btnFire, () => { ensureAudio(); input.fire = true; }, () => (input.fire = false));
  btnSwitch.addEventListener("touchstart", (e) => { e.preventDefault(); input.switchWeaponPressed = true; }, { passive: false });
  btnSwitch.addEventListener("click", () => { input.switchWeaponPressed = true; });

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "f" || e.key === "Control") input.fire = true;
    if (e.key.toLowerCase() === "q") input.switchWeaponPressed = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() === "f" || e.key === "Control") input.fire = false;
  });

  // ---------------------------------------------------------
  // Camera
  // ---------------------------------------------------------
  const camera = { x: 0, y: 0 };
  function updateCamera() {
    const target = player.inCar || player;
    camera.x = target.x - VIEW.w / 2;
    camera.y = target.y - VIEW.h / 2;
  }

  // ---------------------------------------------------------
  // Shop UI (garage / clothing)
  // ---------------------------------------------------------
  const shopModal = document.getElementById("shopModal");
  const shopTitle = document.getElementById("shopTitle");
  const shopSubtitle = document.getElementById("shopSubtitle");
  const shopItemsEl = document.getElementById("shopItems");
  const shopCloseBtn = document.getElementById("shopCloseBtn");
  const interactHint = document.getElementById("interactHint");

  let nearShop = null;
  let shopOpen = false;

  const SHOP_META = {
    garage: { title: "Garage", subtitle: "Spuit je auto of rust 'm uit — stap eerst in een auto." },
    clothing: { title: "Kledingzaak", subtitle: "Een nieuwe look voor Karimo." },
  };

  function findNearbyShop() {
    for (const s of shops) {
      if (Math.hypot(s.x - player.x, s.y - player.y) < s.radius) return s;
    }
    return null;
  }

  function openShop(shop) {
    shopOpen = true;
    gamePaused = true;
    const meta = SHOP_META[shop.kind];
    shopTitle.textContent = meta.title;
    shopSubtitle.textContent = meta.subtitle;
    renderShopItems(shop);
    shopModal.style.display = "flex";
  }

  function closeShop() {
    shopOpen = false;
    shopModal.style.display = "none";
    gamePaused = false;
  }
  shopCloseBtn.addEventListener("click", closeShop);

  function renderShopItems(shop) {
    shopItemsEl.innerHTML = "";
    const catalog = SHOP_CATALOGS[shop.kind];
    for (const item of catalog) {
      const row = document.createElement("div");
      row.className = "shop-item";

      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "shop-item-name";
      name.textContent = item.name;
      const desc = document.createElement("div");
      desc.className = "shop-item-desc";
      desc.textContent = item.desc;
      info.appendChild(name);
      info.appendChild(desc);

      const btn = document.createElement("button");
      btn.className = "shop-buy-btn";

      const owned = isItemOwned(item);
      const needsCar = (item.kind === "paint" || item.kind === "engine_upgrade" || item.kind === "armor_upgrade");
      const carMissing = needsCar && !player.inCar;

      if (owned) {
        btn.textContent = "Actief";
        btn.classList.add("owned");
        btn.disabled = true;
      } else if (carMissing) {
        btn.textContent = "Stap in auto";
        btn.disabled = true;
      } else if (player.cash < item.price) {
        btn.textContent = `f ${item.price},-`;
        btn.disabled = true;
      } else {
        btn.textContent = item.price === 0 ? "Dragen" : `f ${item.price},-`;
        btn.addEventListener("click", () => {
          purchaseItem(item);
          renderShopItems(shop);
        });
      }

      row.appendChild(info);
      row.appendChild(btn);
      shopItemsEl.appendChild(row);
    }
  }

  function isItemOwned(item) {
    if (item.kind === "outfit") return player.jacketColor === item.value && player.ownedOutfits.includes(item.id);
    if (item.kind === "vest") return player.maxHealthBonus >= 25;
    if (item.kind === "paint") return player.inCar && player.inCar.color === item.value;
    if (item.kind === "engine_upgrade") return player.inCar && player.inCar.upgradedEngine;
    if (item.kind === "armor_upgrade") return player.inCar && player.inCar.upgradedArmor;
    return false;
  }

  function purchaseItem(item) {
    if (item.price > 0) {
      if (player.cash < item.price) return;
      player.cash -= item.price;
    }
    sfx("pickup");
    if (item.kind === "outfit") {
      player.jacketColor = item.value;
      if (!player.ownedOutfits.includes(item.id)) player.ownedOutfits.push(item.id);
      flashMessage(`Nieuwe outfit: ${item.name}`);
    } else if (item.kind === "paint" && player.inCar) {
      player.inCar.color = item.value;
      flashMessage("Auto gespoten!");
    } else if (item.kind === "engine_upgrade" && player.inCar) {
      player.inCar.upgradedEngine = true;
      flashMessage("Motor verbeterd!");
    } else if (item.kind === "armor_upgrade" && player.inCar) {
      player.inCar.upgradedArmor = true;
      flashMessage("Pantser aangebracht!");
    } else if (item.kind === "vest") {
      player.maxHealthBonus = 25;
      player.health = Math.min(100 + player.maxHealthBonus, player.health + 25);
      flashMessage("Kogelvrij vest gekocht!");
    }
  }

  function updateShopProximity() {
    if (player.inCar) { nearShop = null; interactHint.style.display = "none"; return; }
    const s = findNearbyShop();
    nearShop = s;
    interactHint.style.display = s && !shopOpen ? "block" : "none";
  }

  // ---------------------------------------------------------
  // Game state machine
  // ---------------------------------------------------------
  let gameStarted = false;
  let gamePaused = false;
  let gameOver = false;
  let lastTime = 0;

  const titleScreen = document.getElementById("titleScreen");
  const playBtn = document.getElementById("playBtn");
  const hud = document.getElementById("hud");
  const touchLayer = document.getElementById("touchLayer");
  const pauseBtn = document.getElementById("pauseBtn");
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const modalText = document.getElementById("modalText");
  const modalBtn = document.getElementById("modalBtn");

  playBtn.addEventListener("click", startGame);
  pauseBtn.addEventListener("click", togglePause);
  modalBtn.addEventListener("click", () => {
    modal.style.display = "none";
    respawnPlayer();
    gamePaused = false;
  });

  function startGame() {
    titleScreen.style.display = "none";
    hud.style.display = "block";
    touchLayer.style.display = "block";
    pauseBtn.style.display = "flex";
    resize();
    ensureAudio();
    refreshWeaponChips();
    gameStarted = true;
    lastTime = performance.now();
    initPaywall();
    missionCooldown = 2.5; // hoofdstuk 1 start kort na het begin
    requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!gameStarted || gameOver) return;
    if (paywallEl.style.display === "flex") return; // paywall heeft voorrang
    if (shopOpen || storyBox.style.display === "block") return;
    gamePaused = !gamePaused;
    pauseBtn.textContent = gamePaused ? "▶" : "⏸";
  }

  function respawnPlayer() {
    player.health = 100;
    player.wanted = Math.max(0, player.wanted - 2);
    player.cash = Math.max(0, player.cash - 50);
    player.inCar = null;
    player.x = player.spawnX;
    player.y = player.spawnY;
    police.length = 0;
    bullets.length = 0;
    gameOver = false;
  }

  function showGameOverModal(title, text) {
    modalTitle.textContent = title;
    modalText.textContent = text;
    modal.style.display = "flex";
    gameOver = true;
  }

  // ---------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------
  function update(dt) {
    readKeyboard();

    // --- Car enter/exit / shop entry ---
    if (input.enterPressed) {
      input.enterPressed = false;
      if (!player.inCar && nearShop && !shopOpen) {
        openShop(nearShop);
        return;
      }
      if (player.inCar) {
        // exit
        const car = player.inCar;
        car.occupied = false;
        player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 28;
        player.y = car.y + Math.sin(car.angle + Math.PI / 2) * 28;
        player.inCar = null;
      } else {
        // find nearest car in range
        let best = null, bestD = 55;
        for (const c of cars) {
          if (c.occupied) continue;
          const d = Math.hypot(c.x - player.x, c.y - player.y);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best) {
          best.occupied = true;
          player.inCar = best;
        }
      }
    }

    if (player.inCar) {
      updateCarPhysics(player.inCar, dt, true);
      player.x = player.inCar.x;
      player.y = player.inCar.y;
    } else {
      updatePlayerWalk(dt);
    }

    updateWeaponSwitch();
    updateCombat(dt);
    updatePolice(dt);
    updateWanted(dt);
    updateMission(dt);
    updatePedestrians(dt);
    updateBullets(dt);
    updatePickups();
    updateShopProximity();
    updateCamera();
    worldTime += dt;

    if (player.health <= 0 && !gameOver) {
      showGameOverModal("Karimo is neergeschoten", "Je wordt naar het ziekenhuis gebracht. Je raakt wat contant geld kwijt.");
    }
  }

  const WEAPON_ORDER = ["fist", "pistol", "uzi"];
  function updateWeaponSwitch() {
    if (input.switchWeaponPressed) {
      input.switchWeaponPressed = false;
      let idx = WEAPON_ORDER.indexOf(player.currentWeapon);
      for (let i = 1; i <= WEAPON_ORDER.length; i++) {
        const next = WEAPON_ORDER[(idx + i) % WEAPON_ORDER.length];
        if (player.weapons[next]) { player.currentWeapon = next; break; }
      }
      refreshWeaponChips();
    }
  }

  function refreshWeaponChips() {
    document.getElementById("chipFist").classList.toggle("active", player.currentWeapon === "fist");
    document.getElementById("chipPistol").classList.toggle("active", player.currentWeapon === "pistol");
    document.getElementById("chipUzi").classList.toggle("active", player.currentWeapon === "uzi");
    document.getElementById("chipPistol").style.display = player.weapons.pistol ? "block" : "none";
    document.getElementById("chipUzi").style.display = player.weapons.uzi ? "block" : "none";
  }

  function updateCombat(dt) {
    if (player.fireCooldown > 0) player.fireCooldown -= dt;
    if (player.inCar) return; // no combat while driving
    if (!input.fire) return;
    if (player.fireCooldown > 0) return;

    const stats = WEAPON_STATS[player.currentWeapon];
    player.fireCooldown = stats.cooldown;

    if (stats.isMelee) {
      sfx("punch");
      // hit nearest target in range in front of player
      const target = findNearestHittable(player.x, player.y, stats.range);
      if (target) applyDamage(target, stats.damage);
    } else {
      // ranged: consume ammo
      const ammoKey = player.currentWeapon;
      if (player.ammo[ammoKey] <= 0) {
        player.currentWeapon = "fist";
        refreshWeaponChips();
        return;
      }
      player.ammo[ammoKey]--;
      sfx("shot");
      bullets.push({
        x: player.x, y: player.y,
        angle: player.angle,
        speed: stats.bulletSpeed,
        damage: stats.damage,
        life: stats.range / stats.bulletSpeed,
        fromPlayer: true,
      });
    }
  }

  function findNearestHittable(x, y, range) {
    let best = null, bestD = range;
    for (const pd of pedestrians) {
      if (!pd.alive) continue;
      const d = Math.hypot(pd.x - x, pd.y - y);
      if (d < bestD) { bestD = d; best = { kind: "ped", ref: pd }; }
    }
    for (const p of police) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = { kind: "police", ref: p }; }
    }
    for (const t of missionTargets) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bestD) { bestD = d; best = { kind: "target", ref: t }; }
    }
    return best;
  }

  function applyDamage(hit, dmg) {
    hit.ref.health -= dmg;
    if (hit.kind === "ped" && hit.ref.health <= 0 && hit.ref.alive) {
      hit.ref.alive = false;
      player.wanted = Math.min(5, player.wanted + 1);
    } else if (hit.kind === "police" && hit.ref.health <= 0) {
      const idx = police.indexOf(hit.ref);
      if (idx >= 0) police.splice(idx, 1);
    } else if (hit.kind === "target" && hit.ref.health <= 0) {
      hit.ref.alive = false;
    }
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      const nx = b.x + Math.cos(b.angle) * b.speed * dt;
      const ny = b.y + Math.sin(b.angle) * b.speed * dt;
      b.x = nx; b.y = ny;

      let hit = false;
      if (b.fromPlayer) {
        for (const pd of pedestrians) {
          if (!pd.alive) continue;
          if (Math.hypot(pd.x - b.x, pd.y - b.y) < 14) {
            applyDamage({ kind: "ped", ref: pd }, b.damage);
            hit = true; break;
          }
        }
        if (!hit) for (const p of police) {
          if (Math.hypot(p.x - b.x, p.y - b.y) < 14) {
            applyDamage({ kind: "police", ref: p }, b.damage);
            hit = true; break;
          }
        }
        if (!hit) for (const t of missionTargets) {
          if (!t.alive) continue;
          if (Math.hypot(t.x - b.x, t.y - b.y) < 16) {
            applyDamage({ kind: "target", ref: t }, b.damage);
            hit = true; break;
          }
        }
      } else {
        if (Math.hypot(player.x - b.x, player.y - b.y) < 14) {
          player.health -= b.damage;
          hit = true;
        }
      }

      if (hit || b.life <= 0 || collidesBuilding(b.x, b.y, 2)) {
        bullets.splice(i, 1);
      }
    }
  }

  function updatePedestrians(dt) {
    for (const pd of pedestrians) {
      if (!pd.alive) continue;
      const distToPlayer = Math.hypot(pd.x - player.x, pd.y - player.y);
      if (distToPlayer < 90 && (player.inCar || input.fire)) {
        pd.scared = true;
      }
      if (pd.scared) {
        const ang = Math.atan2(pd.y - player.y, pd.x - player.x);
        pd.angle = ang;
        const nx = pd.x + Math.cos(ang) * pd.speed * 1.8 * dt;
        const ny = pd.y + Math.sin(ang) * pd.speed * 1.8 * dt;
        if (!collidesBuilding(nx, pd.y, 10)) pd.x = nx;
        if (!collidesBuilding(pd.x, ny, 10)) pd.y = ny;
        pd.wanderT -= dt;
        if (pd.wanderT <= 0) { pd.scared = false; pd.wanderT = 2 + Math.random() * 2; }
      } else {
        pd.wanderT -= dt;
        if (pd.wanderT <= 0) {
          pd.angle = Math.random() * Math.PI * 2;
          pd.wanderT = 1.5 + Math.random() * 2.5;
        }
        const nx = pd.x + Math.cos(pd.angle) * pd.speed * dt;
        const ny = pd.y + Math.sin(pd.angle) * pd.speed * dt;
        if (!collidesBuilding(nx, pd.y, 10)) pd.x = nx; else pd.angle += Math.PI / 2;
        if (!collidesBuilding(pd.x, ny, 10)) pd.y = ny; else pd.angle += Math.PI / 2;
      }
      clampToWorld(pd);

      // player car running over pedestrian
      if (player.inCar && Math.abs(player.inCar.speed) > 60) {
        if (Math.hypot(pd.x - player.inCar.x, pd.y - player.inCar.y) < 22) {
          pd.alive = false;
          player.wanted = Math.min(5, player.wanted + 1);
        }
      }
    }
  }

  function updatePickups() {
    for (const p of pickups) {
      if (p.taken) continue;
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d < 26 && !player.inCar) {
        p.taken = true;
        sfx("pickup");
        if (p.kind === "health") {
          player.health = Math.min(100 + player.maxHealthBonus, player.health + p.amount);
          flashMessage("+ Gezondheid");
        } else if (p.kind === "pistol_ammo") {
          player.ammo.pistol += p.amount;
          flashMessage("+ Pistoolmunitie");
        } else if (p.kind === "uzi_ammo") {
          player.ammo.uzi += p.amount;
          flashMessage("+ Uzi-munitie");
        } else if (p.kind === "cash") {
          player.cash += p.amount;
          flashMessage(`+ f ${p.amount},-`);
        } else if (p.kind === "weapon_pistol") {
          player.weapons.pistol = true;
          player.ammo.pistol += 12;
          player.currentWeapon = "pistol";
          refreshWeaponChips();
          flashMessage("Pistool buitgemaakt!");
        } else if (p.kind === "weapon_uzi") {
          player.weapons.uzi = true;
          player.ammo.uzi += 40;
          player.currentWeapon = "uzi";
          refreshWeaponChips();
          flashMessage("Uzi buitgemaakt!");
        }
      }
    }
  }

  function updatePlayerWalk(dt) {
    const mx = input.moveX, my = input.moveY;
    const mag = Math.hypot(mx, my);
    if (mag > 0.08) {
      player.angle = Math.atan2(my, mx);
      const nx = player.x + (mx / mag) * player.walkSpeed * dt;
      const ny = player.y + (my / mag) * player.walkSpeed * dt;
      if (!collidesBuilding(nx, player.y, player.radius)) player.x = nx;
      if (!collidesBuilding(player.x, ny, player.radius)) player.y = ny;
      clampToWorld(player);
    }
  }

  function clampToWorld(e) {
    e.x = Math.max(20, Math.min(WORLD.size - 20, e.x));
    e.y = Math.max(20, Math.min(WORLD.size - 20, e.y));
  }

  function updateCarPhysics(car, dt, isPlayerCar) {
    const turnSpeed = 2.4;
    const topSpeed = car.upgradedEngine ? 430 : 340;
    const accel = car.upgradedEngine ? 280 : 220;
    const bounce = car.upgradedArmor ? -0.12 : -0.3;
    let steer = 0;
    if (isPlayerCar) {
      steer = input.moveX;
      if (input.gas) car.speed = Math.min(car.speed + accel * dt, topSpeed);
      else if (input.brake) car.speed = Math.max(car.speed - 260 * dt, -140);
      else car.speed *= (1 - Math.min(1, 1.2 * dt));
      if (Math.abs(car.speed) < 2) car.speed = 0;
    }
    if (Math.abs(car.speed) > 4) {
      car.angle += steer * turnSpeed * dt * Math.sign(car.speed || 1) * 0.6;
    }
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    if (!collidesBuilding(nx, car.y, 20)) car.x = nx; else car.speed *= bounce;
    if (!collidesBuilding(car.x, ny, 20)) car.y = ny; else car.speed *= bounce;
    clampToWorld(car);
  }

  function updatePolice(dt) {
    // spawn logic based on wanted level
    if (player.wanted > 0) {
      policeSpawnTimer -= dt;
      const desiredCount = player.wanted * 2;
      if (policeSpawnTimer <= 0 && police.length < desiredCount) {
        spawnPoliceUnit();
        policeSpawnTimer = Math.max(0.6, 2.2 - player.wanted * 0.3);
      }
    } else {
      // despawn gradually when not wanted
      if (police.length > 0 && Math.random() < dt * 0.5) police.pop();
    }

    for (const p of police) {
      const dx = player.x - p.x, dy = player.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      p.angle = Math.atan2(dy, dx);
      const armed = player.wanted >= 3;
      const standoff = armed ? 180 : 20;

      if (!armed || dist > standoff) {
        const spd = 95 + player.wanted * 12;
        const nx = p.x + (dx / dist) * spd * dt;
        const ny = p.y + (dy / dist) * spd * dt;
        if (!collidesBuilding(nx, p.y, p.radius)) p.x = nx;
        if (!collidesBuilding(p.x, ny, p.radius)) p.y = ny;
      }

      if (dist < 26 && player.wanted > 0 && player.wanted < 3) {
        player.health -= 14 * dt;
        player.cash = Math.max(0, player.cash - 10 * dt);
      }

      if (armed) {
        p.fireCooldown = (p.fireCooldown || 0) - dt;
        if (dist < 420 && p.fireCooldown <= 0) {
          p.fireCooldown = 1.1 - Math.min(0.6, player.wanted * 0.1);
          sfx("shot");
          bullets.push({
            x: p.x, y: p.y, angle: Math.atan2(dy, dx),
            speed: 520, damage: 9, life: 0.9, fromPlayer: false,
          });
        }
      }
    }
  }

  let heatTimer = 0; // used by chaos (random minor wanted ticks removed; wanted only rises via explicit actions)
  function updateWanted(dt) {
    // Wanted decays slowly if no police nearby
    const anyClose = police.some(p => Math.hypot(p.x - player.x, p.y - player.y) < 500);
    if (!anyClose && player.wanted > 0) {
      heatTimer += dt;
      if (heatTimer > 4) {
        player.wanted = Math.max(0, player.wanted - 1);
        heatTimer = 0;
      }
    } else {
      heatTimer = 0;
    }
    document.getElementById("wantedStars").textContent =
      "★".repeat(player.wanted) + "☆".repeat(5 - player.wanted);
  }

  function updateMission(dt) {
    document.getElementById("cashPanel").textContent = `f ${Math.floor(player.cash)},-`;
    const maxHp = 100 + player.maxHealthBonus;
    document.getElementById("healthBar").style.width = Math.max(0, (player.health / maxHp) * 100) + "%";
    document.getElementById("levelPanel").textContent = `REP ${player.reputation}`;

    if (missionState === "none") {
      missionCooldown -= dt;
      if (missionCooldown <= 0) startRandomMission();
      return;
    }

    if (!currentMission) return;

    if (currentMission.type === "fetch-deliver" && missionMarker) {
      const d = Math.hypot(player.x - missionMarker.x, player.y - missionMarker.y);
      if (missionMarker.kind === "pickup" && d < 36) {
        const drop = randomSpotNear(player.x, player.y, 250, 600);
        missionMarker = { x: drop.x, y: drop.y, kind: "dropoff" };
        flashMessage("Pakketje opgehaald — breng het naar de drop-zone");
      } else if (missionMarker.kind === "dropoff" && d < 36) {
        completeMission(true);
      }
    } else if (currentMission.type === "race") {
      missionTimer -= dt;
      if (missionMarker) {
        const d = Math.hypot(player.x - missionMarker.x, player.y - missionMarker.y);
        if (d < 40) completeMission(true);
      }
      if (missionTimer <= 0) completeMission(false);
    } else if (currentMission.type === "lose-heat") {
      if (player.wanted === 0) {
        missionTimer -= dt;
        if (missionTimer <= 0) completeMission(true);
      } else {
        missionTimer = 20;
      }
    } else if (currentMission.type === "taxi" && missionMarker) {
      const d = Math.hypot(player.x - missionMarker.x, player.y - missionMarker.y);
      if (missionMarker.kind === "passenger" && d < 40 && player.inCar) {
        const drop = randomSpotNear(player.x, player.y, 300, 700);
        missionMarker = { x: drop.x, y: drop.y, kind: "car-drop" };
        flashMessage("Passagier ingestapt — breng ze naar de bestemming");
      } else if (missionMarker.kind === "car-drop" && d < 40 && player.inCar) {
        completeMission(true);
      }
    } else if (currentMission.type === "steal-car") {
      if (!missionCarRef) { completeMission(false); return; }
      if (player.inCar === missionCarRef && missionMarker) {
        const d = Math.hypot(missionCarRef.x - missionMarker.x, missionCarRef.y - missionMarker.y);
        if (d < 45) completeMission(true);
      }
    } else if (currentMission.type === "clear-targets") {
      const remaining = missionTargets.filter(t => t.alive).length;
      if (remaining === 0) completeMission(true);
    }
  }

  // ---------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------
  function draw() {
    ctx.save();
    ctx.fillStyle = "#1c1030";
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    ctx.translate(-camera.x, -camera.y);

    drawGround();
    drawCanals();
    drawRoadMarkings();
    drawBuildings();
    drawShops();
    drawPickups();
    drawMissionMarker();
    drawMissionTargets();
    drawPedestrians();
    drawCars();
    drawPolice();
    drawBullets();
    drawPlayer();

    ctx.restore();

    drawNightOverlay();
    drawRain(0.016);
    drawVignette();
    drawRadar();
  }

  function drawRain(dt) {
    const f = dayNightFactor();
    const intensity = Math.max(0, f - 0.25); // only rains during darker hours
    if (intensity <= 0.01) return;
    ctx.save();
    ctx.strokeStyle = `rgba(190,210,255,${(0.25 * intensity).toFixed(3)})`;
    ctx.lineWidth = 1;
    const activeCount = Math.floor(RAIN_COUNT * Math.min(1, intensity * 1.6));
    for (let i = 0; i < activeCount; i++) {
      const d = rainDrops[i];
      d.y += (d.speed * dt) / VIEW.h;
      if (d.y > 1) { d.y = 0; d.x = Math.random(); }
      const sx = d.x * VIEW.w;
      const sy = d.y * VIEW.h;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 3, sy + d.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  function visibleWorldRect() {
    const pad = 80;
    return {
      x0: camera.x - pad, y0: camera.y - pad,
      x1: camera.x + VIEW.w + pad, y1: camera.y + VIEW.h + pad,
    };
  }

  function drawGround() {
    const r = visibleWorldRect();
    ctx.fillStyle = "#2b1a4a";
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  }

  function drawCanals() {
    const r = visibleWorldRect();
    ctx.save();
    for (const s of CANAL.strips) {
      const grad = ctx.createLinearGradient(0, 0, s.vertical ? 1 : 0, s.vertical ? 0 : 1);
      ctx.fillStyle = "#133a4a";
      if (s.vertical) {
        ctx.fillRect(s.x - s.w / 2, r.y0, s.w, r.y1 - r.y0);
        ctx.strokeStyle = "rgba(46,230,255,0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - s.w / 2, r.y0); ctx.lineTo(s.x - s.w / 2, r.y1);
        ctx.moveTo(s.x + s.w / 2, r.y0); ctx.lineTo(s.x + s.w / 2, r.y1);
        ctx.stroke();
      } else {
        ctx.fillRect(r.x0, s.y - s.h / 2, r.x1 - r.x0, s.h);
        ctx.strokeStyle = "rgba(46,230,255,0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(r.x0, s.y - s.h / 2); ctx.lineTo(r.x1, s.y - s.h / 2);
        ctx.moveTo(r.x0, s.y + s.h / 2); ctx.lineTo(r.x1, s.y + s.h / 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawRoadMarkings() {
    const r = visibleWorldRect();
    const bs = WORLD.blockSize;
    ctx.save();
    ctx.strokeStyle = "rgba(255,225,77,0.18)";
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 14]);
    const startX = Math.floor(r.x0 / bs) * bs;
    for (let x = startX; x < r.x1; x += bs) {
      ctx.beginPath(); ctx.moveTo(x, r.y0); ctx.lineTo(x, r.y1); ctx.stroke();
    }
    const startY = Math.floor(r.y0 / bs) * bs;
    for (let y = startY; y < r.y1; y += bs) {
      ctx.beginPath(); ctx.moveTo(r.x0, y); ctx.lineTo(r.x1, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBuildings() {
    const r = visibleWorldRect();
    const night = dayNightFactor();
    for (const b of BUILDINGS) {
      if (b.x + b.w < r.x0 || b.x > r.x1 || b.y + b.h < r.y0 || b.y > r.y1) continue;

      // depth shadow — taller tiers cast a bigger offset shadow (cheap pseudo-3D)
      const shadowOff = 3 + b.heightTier * 3;
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(b.x + shadowOff, b.y + shadowOff, b.w, b.h);

      // base + trim
      ctx.fillStyle = b.baseColor;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.trimColor;
      ctx.fillRect(b.x, b.y, b.w, 4);
      ctx.fillRect(b.x, b.y, 4, b.h);

      ctx.strokeStyle = b.roof === "pink" ? "rgba(255,46,142,0.5)" : "rgba(46,230,255,0.45)";
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);

      // storey lines + windows (lit windows increase at night)
      const litChance = 0.28 + night * 0.4;
      for (let s = 0; s < b.storeys; s++) {
        const rowY = b.y + 6 + s * b.storeyH;
        if (rowY > b.y + b.h - 8) break;
        const cols = Math.max(2, Math.floor(b.w / 22));
        const colW = (b.w - 12) / cols;
        for (let c = 0; c < cols; c++) {
          const seed = (b.litWindowSeed * 997 + s * 31 + c * 13) % 1;
          const lit = seed < litChance;
          ctx.fillStyle = lit ? "rgba(255,210,120,0.55)" : "rgba(10,8,20,0.45)";
          ctx.fillRect(b.x + 6 + c * colW, rowY, colW - 4, Math.min(10, b.storeyH - 5));
        }
      }

      // awning over a ground-floor entrance
      if (b.hasAwning) {
        const aw = Math.min(40, b.w * 0.4);
        ctx.fillStyle = b.awningColor;
        ctx.fillRect(b.x + b.w * 0.5 - aw / 2, b.y + b.h - 10, aw, 7);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(b.x + b.w * 0.5 - aw / 2 + (aw / 4) * i, b.y + b.h - 10, aw / 8, 7);
        }
      }

      // neon sign on facade
      if (b.hasNeon) {
        const pulse = 0.65 + Math.sin(performance.now() / 420 + b.x) * 0.25;
        ctx.save();
        ctx.font = "bold 9px Courier New";
        ctx.textAlign = "center";
        ctx.fillStyle = b.neonColor;
        ctx.shadowColor = b.neonColor;
        ctx.shadowBlur = 8 * pulse;
        ctx.globalAlpha = Math.max(0.35, pulse);
        ctx.fillText(b.neonText, b.x + b.w / 2, b.y + 18);
        ctx.restore();
      }
    }
  }

  const PICKUP_COLORS = {
    health: "#ff6b9d", pistol_ammo: "#ffe14d", uzi_ammo: "#ffe14d",
    cash: "#5dffa3", weapon_pistol: "#2ee6ff", weapon_uzi: "#2ee6ff",
  };
  const PICKUP_LABELS = {
    health: "+", pistol_ammo: "•", uzi_ammo: "••", cash: "f", weapon_pistol: "P", weapon_uzi: "U",
  };

  function drawShops() {
    const r = visibleWorldRect();
    for (const s of shops) {
      if (s.x < r.x0 || s.x > r.x1 || s.y < r.y0 || s.y > r.y1) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.fillStyle = s.kind === "garage" ? "rgba(46,230,255,0.18)" : "rgba(255,46,142,0.18)";
      ctx.beginPath();
      ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.kind === "garage" ? "#2ee6ff" : "#ff2e8e";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px Courier New";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.kind === "garage" ? "🔧" : "👕", 0, 0);
      ctx.restore();
    }
  }

  function drawPickups() {
    const r = visibleWorldRect();
    const t = performance.now() / 260;
    for (const p of pickups) {
      if (p.taken) continue;
      if (p.x < r.x0 || p.x > r.x1 || p.y < r.y0 || p.y > r.y1) continue;
      const bob = Math.sin(t + p.bob) * 4;
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      ctx.fillStyle = PICKUP_COLORS[p.kind] || "#fff";
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#0c0a17";
      ctx.font = "bold 10px Courier New";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(PICKUP_LABELS[p.kind] || "?", 0, 1);
      ctx.restore();
    }
  }

  function drawMissionTargets() {
    for (const t of missionTargets) {
      if (!t.alive) continue;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.arc(0, 2, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#7a1f3d";
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,46,142,0.8)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      // health pip
      ctx.save();
      ctx.translate(t.x - 14, t.y - 24);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, 28, 4);
      ctx.fillStyle = "#ff2e8e";
      ctx.fillRect(0, 0, 28 * (t.health / 35), 4);
      ctx.restore();
    }
  }

  function drawPedestrians() {
    const r = visibleWorldRect();
    for (const pd of pedestrians) {
      if (!pd.alive) continue;
      if (pd.x < r.x0 || pd.x > r.x1 || pd.y < r.y0 || pd.y > r.y1) continue;
      drawPersonSprite(pd.x, pd.y, pd.angle, { jacket: pd.color, r: 8 });
    }
  }

  function drawBullets() {
    for (const b of bullets) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.fromPlayer ? "#ffe14d" : "#ff4d6d";
      ctx.fillRect(-4, -1.5, 8, 3);
      ctx.restore();
    }
  }

  function drawNightOverlay() {
    const f = dayNightFactor();
    if (f <= 0.02) return;
    ctx.save();
    ctx.fillStyle = `rgba(10,8,30,${(f * 0.55).toFixed(3)})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    // warm street-light glow near player position on screen
    const g = ctx.createRadialGradient(VIEW.w/2, VIEW.h/2, 20, VIEW.w/2, VIEW.h/2, 260);
    g.addColorStop(0, `rgba(255,210,140,${(f * 0.12).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,210,140,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.restore();
  }

  function drawMissionMarker() {
    if (!missionMarker) return;
    const t = performance.now() / 300;
    const bob = Math.sin(t) * 6;
    const pickupLike = missionMarker.kind === "pickup" || missionMarker.kind === "passenger";
    const markerColor = pickupLike ? "#ffe14d" : "#2ee6ff";

    ctx.save();
    ctx.translate(missionMarker.x, missionMarker.y + bob);
    ctx.fillStyle = markerColor;
    ctx.beginPath();
    ctx.moveTo(0, -22); ctx.lineTo(10, -6); ctx.lineTo(-10, -6); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -28, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ground ring
    ctx.save();
    ctx.strokeStyle = pickupLike ? "rgba(255,225,77,0.6)" : "rgba(46,230,255,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(missionMarker.x, missionMarker.y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCarShape(c, bodyColor) {
    const w = c.w, h = c.h;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);

    // soft drop shadow, offset toward "down" in world space regardless of car angle
    ctx.save();
    ctx.rotate(-c.angle);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(3, 4, w / 1.9, h / 1.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // wheels (peek out from under the body at the four corners)
    ctx.fillStyle = "#15111f";
    const wheelW = 6, wheelL = h * 0.32;
    ctx.fillRect(-w / 2 + 3, -h / 2 - 1.5, wheelW, wheelL);
    ctx.fillRect(-w / 2 + 3, h / 2 - wheelL + 1.5, wheelW, wheelL);
    ctx.fillRect(w / 2 - 3 - wheelW, -h / 2 - 1.5, wheelW, wheelL);
    ctx.fillRect(w / 2 - 3 - wheelW, h / 2 - wheelL + 1.5, wheelW, wheelL);

    // body base
    const bodyGrad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    bodyGrad.addColorStop(0, lighten(bodyColor, 18));
    bodyGrad.addColorStop(0.5, bodyColor);
    bodyGrad.addColorStop(1, darken(bodyColor, 18));
    roundRectPath(-w / 2, -h / 2, w, h, 4);
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // windshield (front) + rear window, with a center cabin band
    ctx.fillStyle = "rgba(20,24,40,0.85)";
    roundRectPath(w * 0.08, -h / 2 + 2.5, w * 0.34, h - 5, 2);
    ctx.fill();
    ctx.fillStyle = "rgba(120,180,220,0.35)";
    roundRectPath(w * 0.1, -h / 2 + 3.5, w * 0.12, h - 7, 1.5);
    ctx.fill();

    // body highlight sweep
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(-w / 2 + 3, -h / 2 + 2, w - 6, 2);

    // headlights (front = local +x) and taillights (rear = local -x)
    ctx.fillStyle = "#fff6c9";
    ctx.fillRect(w / 2 - 2.5, -h / 2 + 1, 2.5, 3);
    ctx.fillRect(w / 2 - 2.5, h / 2 - 4, 2.5, 3);
    ctx.fillStyle = "#ff2e4d";
    ctx.fillRect(-w / 2, -h / 2 + 1, 2.5, 3);
    ctx.fillRect(-w / 2, h / 2 - 4, 2.5, 3);

    // outline
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    roundRectPath(-w / 2, -h / 2, w, h, 4);
    ctx.stroke();

    ctx.restore();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function lighten(hex, amt) { return shiftColor(hex, amt); }
  function darken(hex, amt) { return shiftColor(hex, -amt); }
  function shiftColor(hex, amt) {
    const c = hex.replace("#", "");
    const num = parseInt(c.length === 3
      ? c.split("").map(ch => ch + ch).join("")
      : c, 16);
    let r = (num >> 16) + amt;
    let g = ((num >> 8) & 0xff) + amt;
    let b = (num & 0xff) + amt;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }

  function drawCars() {
    const r = visibleWorldRect();
    for (const c of cars) {
      if (c.x < r.x0 || c.x > r.x1 || c.y < r.y0 || c.y > r.y1) continue;
      if (c === player.inCar) continue;
      drawCarShape(c, c.color);
    }
  }

  function drawPolice() {
    for (const p of police) {
      const armed = player.wanted >= 3;
      const flashing = armed && (p.fireCooldown || 0) > 0.85;
      drawPersonSprite(p.x, p.y, p.angle, {
        jacket: "#1b3a6b", r: p.radius, armed, muzzleFlash: flashing,
      });
      // cap badge glint
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = "#2ee6ff";
      ctx.beginPath(); ctx.arc(-p.radius * 0.1, -p.radius * 0.5, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawPersonSprite(x, y, angle, opts) {
    const o = Object.assign({
      jacket: "#ff2e8e", skin: "#e8b48c", hair: "#2a1f3d",
      r: 11, armed: false, muzzleFlash: false,
    }, opts);
    ctx.save();
    ctx.translate(x, y);

    // ground shadow (stays screen-aligned)
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(2, o.r * 0.55, o.r * 0.9, o.r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(angle);

    // legs (slight offset behind body)
    ctx.fillStyle = "#1c1430";
    ctx.fillRect(-o.r * 0.45, -o.r * 0.3, o.r * 0.9, o.r * 0.9);

    // torso / jacket (teardrop-ish via circle + rect)
    ctx.fillStyle = o.jacket;
    ctx.beginPath();
    ctx.arc(0, 0, o.r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    // facing indicator: a lighter wedge toward direction of travel
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.moveTo(o.r * 0.78, 0);
    ctx.arc(0, 0, o.r * 0.78, -0.5, 0.5);
    ctx.closePath();
    ctx.fill();

    // head
    ctx.fillStyle = o.skin;
    ctx.beginPath();
    ctx.arc(o.r * 0.25, 0, o.r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = o.hair;
    ctx.beginPath();
    ctx.arc(o.r * 0.18, -o.r * 0.12, o.r * 0.3, Math.PI, Math.PI * 2.1);
    ctx.fill();

    // weapon glint if armed
    if (o.armed) {
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(o.r * 0.5, -2, o.r * 0.9, 4);
    }
    if (o.muzzleFlash) {
      ctx.fillStyle = "#ffe14d";
      ctx.beginPath();
      ctx.arc(o.r * 1.3, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawPlayer() {
    if (player.inCar) {
      drawCarShape(player.inCar, "#ffe14d");
      return;
    }
    const armed = player.currentWeapon !== "fist";
    const flashing = armed && player.fireCooldown > WEAPON_STATS[player.currentWeapon].cooldown * 0.6;
    drawPersonSprite(player.x, player.y, player.angle, {
      jacket: player.jacketColor, r: player.radius, armed, muzzleFlash: flashing,
    });
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(
      VIEW.w / 2, VIEW.h / 2, Math.min(VIEW.w, VIEW.h) * 0.35,
      VIEW.w / 2, VIEW.h / 2, Math.max(VIEW.w, VIEW.h) * 0.72
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  function drawRadar() {
    if (!radarCtx) return;
    const size = 112;
    const cx = size / 2, cy = size / 2;
    const radius = size / 2 - 3;
    const range = 420; // world units visible on radar

    radarCtx.clearRect(0, 0, size, size);
    radarCtx.save();
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    radarCtx.clip();

    // faint concentric rings
    radarCtx.strokeStyle = "rgba(46,230,255,0.12)";
    radarCtx.lineWidth = 1;
    for (let ring = 1; ring <= 3; ring++) {
      radarCtx.beginPath();
      radarCtx.arc(cx, cy, (radius / 3) * ring, 0, Math.PI * 2);
      radarCtx.stroke();
    }

    const toRadar = (wx, wy) => {
      const dx = (wx - player.x) / range * radius;
      const dy = (wy - player.y) / range * radius;
      return [cx + dx, cy + dy];
    };

    // canals as faint teal bands
    radarCtx.fillStyle = "rgba(19,58,74,0.9)";
    for (const s of CANAL.strips) {
      if (s.vertical) {
        const [x1] = toRadar(s.x - s.w / 2, player.y);
        const [x2] = toRadar(s.x + s.w / 2, player.y);
        radarCtx.fillRect(x1, 0, Math.max(1, x2 - x1), size);
      } else {
        const [, y1] = toRadar(player.x, s.y - s.h / 2);
        const [, y2] = toRadar(player.x, s.y + s.h / 2);
        radarCtx.fillRect(0, y1, size, Math.max(1, y2 - y1));
      }
    }

    // shops (small square blips)
    for (const s of shops) {
      const [sx, sy] = toRadar(s.x, s.y);
      if (Math.hypot(sx - cx, sy - cy) < radius) {
        radarCtx.fillStyle = s.kind === "garage" ? "rgba(46,230,255,0.8)" : "rgba(255,46,142,0.8)";
        radarCtx.fillRect(sx - 2, sy - 2, 4, 4);
      }
    }

    // mission marker (diamond)
    if (missionMarker) {
      const [mx, my] = toRadar(missionMarker.x, missionMarker.y);
      if (Math.hypot(mx - cx, my - cy) < radius) {
        radarCtx.save();
        radarCtx.translate(mx, my);
        radarCtx.rotate(Math.PI / 4);
        radarCtx.fillStyle = "#ffe14d";
        radarCtx.fillRect(-3, -3, 6, 6);
        radarCtx.restore();
      }
    }
    for (const t of missionTargets) {
      if (!t.alive) continue;
      const [mx, my] = toRadar(t.x, t.y);
      if (Math.hypot(mx - cx, my - cy) < radius) {
        radarCtx.fillStyle = "#ff2e8e";
        radarCtx.beginPath(); radarCtx.arc(mx, my, 2.6, 0, Math.PI * 2); radarCtx.fill();
      }
    }

    // police blips (pulse when close)
    for (const p of police) {
      const [px, py] = toRadar(p.x, p.y);
      if (Math.hypot(px - cx, py - cy) < radius) {
        const pulse = 2 + Math.sin(performance.now() / 150) * 0.8;
        radarCtx.fillStyle = "#ff4d6d";
        radarCtx.beginPath(); radarCtx.arc(px, py, pulse, 0, Math.PI * 2); radarCtx.fill();
      }
    }

    // nearby cars (small dim dots)
    for (const c of cars) {
      if (c.occupied) continue;
      const [cx2, cy2] = toRadar(c.x, c.y);
      if (Math.hypot(cx2 - cx, cy2 - cy) < radius) {
        radarCtx.fillStyle = "rgba(255,255,255,0.35)";
        radarCtx.fillRect(cx2 - 1, cy2 - 1, 2, 2);
      }
    }

    // player — always centered, drawn as a bright directional triangle
    radarCtx.save();
    radarCtx.translate(cx, cy);
    radarCtx.rotate(player.angle + Math.PI / 2);
    radarCtx.fillStyle = "#2ee6ff";
    radarCtx.shadowColor = "#2ee6ff";
    radarCtx.shadowBlur = 6;
    radarCtx.beginPath();
    radarCtx.moveTo(0, -6);
    radarCtx.lineTo(4, 5);
    radarCtx.lineTo(-4, 5);
    radarCtx.closePath();
    radarCtx.fill();
    radarCtx.restore();

    radarCtx.restore(); // end clip
  }

  // ---------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------
  function loop(now) {
    if (!gameStarted) return;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (!gamePaused && !gameOver) {
      update(dt);
      tickPaywallClock(dt);
    }
    draw();

    requestAnimationFrame(loop);
  }

  resize();
  draw(); // initial paint behind title screen
  checkReturnFromStripe();
})();
