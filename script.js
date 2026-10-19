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

  const BUILDINGS = [];
  (function generateBuildings() {
    const rng = mulberry32(1991);
    const bs = WORLD.blockSize;
    const rw = WORLD.roadWidth;
    for (let bx = 0; bx < WORLD.size; bx += bs) {
      for (let by = 0; by < WORLD.size; by += bs) {
        const cx = bx + bs / 2;
        const cy = by + bs / 2;
        if (inAnyCanal(cx, cy, 130)) continue;
        const pad = rw / 2 + 14;
        const bw = bs - pad * 2 - rng() * 30;
        const bh = bs - pad * 2 - rng() * 30;
        if (bw < 40 || bh < 40) continue;
        const hue = 260 + rng() * 60;
        const hueRoof = rng() < 0.5 ? "pink" : "cyan";
        BUILDINGS.push({
          x: bx + pad,
          y: by + pad,
          w: bw,
          h: bh,
          color: `hsl(${hue.toFixed(0)}, 38%, ${(16 + rng() * 10).toFixed(0)}%)`,
          roof: hueRoof,
          windows: Math.max(2, Math.floor(bh / 30)),
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

  function startRandomMission() {
    const def = MISSION_DEFS[Math.floor(Math.random() * MISSION_DEFS.length)];
    currentMission = def;
    missionState = "active";
    showMissionBanner(def.title, def.text);
    sfx("mission");

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
    } else if (def.type === "taxi") {
      const pass = randomSpotNear(player.x, player.y, 150, 450);
      missionMarker = { x: pass.x, y: pass.y, kind: "passenger" };
    } else if (def.type === "steal-car") {
      // pick an existing unoccupied car as the one to deliver
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

  function completeMission(success) {
    if (success && currentMission) {
      const bonus = Math.floor(currentMission.reward * (1 + (player.reputation - 1) * 0.15));
      player.cash += bonus;
      player.missionsCompleted++;
      if (player.missionsCompleted % 3 === 0) {
        player.reputation++;
        flashMessage(`Missie geslaagd! +f ${bonus},- — Reputatie ${player.reputation}!`);
      } else {
        flashMessage(`Missie geslaagd! +f ${bonus},-`);
      }
      sfx("mission");
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
    if (keys["arrowleft"] || keys["a"]) mx -= 1;
    if (keys["arrowright"] || keys["d"]) mx += 1;
    if (keys["arrowup"] || keys["w"]) my -= 1;
    if (keys["arrowdown"] || keys["s"]) my += 1;
    input.moveX = mx; input.moveY = my;
    input.gas = !!keys["arrowup"] || !!keys["w"] || !!keys[" "];
    input.brake = !!keys["arrowdown"] || !!keys["s"];
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
    requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!gameStarted || gameOver) return;
    if (paywallEl.style.display === "flex") return; // paywall heeft voorrang
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

    // --- Car enter/exit ---
    if (input.enterPressed) {
      input.enterPressed = false;
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
          player.health = Math.min(100, player.health + p.amount);
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
    let steer = 0;
    if (isPlayerCar) {
      steer = input.moveX;
      if (input.gas) car.speed = Math.min(car.speed + 220 * dt, 340);
      else if (input.brake) car.speed = Math.max(car.speed - 260 * dt, -140);
      else car.speed *= (1 - Math.min(1, 1.2 * dt));
      if (Math.abs(car.speed) < 2) car.speed = 0;
    }
    if (Math.abs(car.speed) > 4) {
      car.angle += steer * turnSpeed * dt * Math.sign(car.speed || 1) * 0.6;
    }
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    if (!collidesBuilding(nx, car.y, 20)) car.x = nx; else car.speed *= -0.3;
    if (!collidesBuilding(car.x, ny, 20)) car.y = ny; else car.speed *= -0.3;
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
    document.getElementById("healthBar").style.width = Math.max(0, player.health) + "%";
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
    drawVignette();
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
    for (const b of BUILDINGS) {
      if (b.x + b.w < r.x0 || b.x > r.x1 || b.y + b.h < r.y0 || b.y > r.y1) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // roof trim neon
      ctx.strokeStyle = b.roof === "pink" ? "rgba(255,46,142,0.55)" : "rgba(46,230,255,0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      // windows
      ctx.fillStyle = "rgba(255,225,77,0.35)";
      const rowH = b.h / b.windows;
      for (let i = 0; i < b.windows; i++) {
        if ((i + Math.floor(b.x)) % 3 === 0) continue;
        ctx.fillRect(b.x + 6, b.y + i * rowH + 6, b.w - 12, Math.max(4, rowH - 10));
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
      ctx.save();
      ctx.translate(pd.x, pd.y);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.arc(0, 2, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pd.color;
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
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
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(-c.w / 2, -c.h / 2 + 3, c.w, c.h);
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(-c.w / 2 + 6, -c.h / 2 + 2, c.w - 16, c.h - 4);
    ctx.fillStyle = "#ffe14d";
    ctx.fillRect(c.w / 2 - 4, -c.h / 2 + 1, 3, 3);
    ctx.fillRect(c.w / 2 - 4, c.h / 2 - 4, 3, 3);
    ctx.restore();
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
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.arc(0, 2, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1b3a6b";
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2ee6ff";
      ctx.fillRect(8, -2, 5, 4);
      ctx.restore();
    }
  }

  function drawPlayer() {
    if (player.inCar) {
      drawCarShape(player.inCar, "#ffe14d");
      return;
    }
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.arc(0, 2, player.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff2e8e";
    ctx.beginPath(); ctx.arc(0, 0, player.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffe14d";
    ctx.fillRect(player.radius - 5, -3, 6, 6);
    ctx.restore();
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
