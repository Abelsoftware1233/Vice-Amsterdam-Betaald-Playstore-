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
  // i18n — Nederlands / Engels
  // ---------------------------------------------------------
  const I18N = {
    nl: {
      // Titelscherm
      titleCity: "AMSTERDAM, 1991",
      gameSubtitle: "EEN VERHAAL VAN KARIMO",
      playBtn: "START",
      titleHint: "Links: joystick om te lopen. Stap in een auto om te rijden.<br>Rond op mobiel &middot; fictieve stad, fictief verhaal",
      // HUD
      weaponFist: "VUIST",
      weaponPistol: "PISTOOL",
      weaponUzi: "UZI",
      repLabel: "REP",
      // Paywall
      pwTitle: "Je gratis tijd zit erop",
      pwText: "Je hebt 30 minuten gratis gespeeld in Vice Amsterdam. Koop nu eenmalig toegang en speel voor altijd verder — op dit toestel.",
      pwBuyBtn: "Nu kopen",
      pwBuying: "Even geduld...",
      pwErrorStart: "Betaling starten mislukt. Probeer het opnieuw.",
      pwErrorConnect: "Kan geen verbinding maken met de server. Probeer het later opnieuw.",
      // Touch controls
      btnEnter: "IN / UIT",
      btnBrake: "REM",
      btnGas: "GAS",
      btnFire: "VUUR",
      btnSwitch: "WISSEL<br>WAPEN",
      interactHint: "Tik ENTER om naar binnen te gaan",
      // Story
      storyTapHint: "tik om door te gaan ▸",
      // Shop
      shopCloseBtn: "Sluiten",
      modalBtn: "Opnieuw",
      ownedBtn: "Actief",
      getInCarBtn: "Stap in auto",
      weaponNeededBtn: "Wapen nodig",
      wearBtn: "Dragen",
      // Game-over modal
      caughtTitle: "Gepakt door de politie",
      caughtText: "Karimo is opgepakt. Je raakt een deel van je contant geld kwijt.",
      shotTitle: "Karimo is neergeschoten",
      shotText: "Je wordt naar het ziekenhuis gebracht. Je raakt wat contant geld kwijt.",
      cantExitAirborne: "Je kunt niet uitstappen in de lucht!",
      // Missies (losse/zij-missies)
      mTitleDelivery1: "Pakketje bezorgen",
      mTextDelivery1: "Haal het pakketje op bij de markering en breng het naar de drop-zone.",
      mTitleRace1: "Straatrace",
      mTextRace1: "Rijd met een auto naar de finish voordat de tijd om is.",
      mTitleEscape1: "Uit het zicht blijven",
      mTextEscape1: "Verlies je wanted-level door 20 seconden uit het zicht van de politie te blijven.",
      mTitleTaxi1: "Taxiritje",
      mTextTaxi1: "Haal de passagier op en breng diegene naar de bestemming.",
      mTitleSteal1: "Auto regelen",
      mTextSteal1: "Breng een auto naar de markering voor een klant.",
      mTitleClear1: "Terrein zuiveren",
      mTextClear1: "Schakel alle gemarkeerde doelen uit.",
      mTitleSmuggle1: "Wapens afleveren",
      mTextSmuggle1: "Haal de lading op en breng 'm ongezien naar de afnemer.",
      mTitleVip1: "VIP beschermen",
      mTextVip1: "Haal de VIP op en breng diegene veilig weg — rijd rustig, geen aandacht trekken.",
      missionBannerSide: "Zijmissie",
      missionBannerStory: "Hoofdverhaal",
      missionSucceeded: "Missie geslaagd!",
      missionFailed: "Missie mislukt.",
      repUp: "Reputatie",
      missionSuccessPlain: (bonus) => `Missie geslaagd! +f ${bonus},-`,
      missionSuccessRep: (bonus, rep) => `Missie geslaagd! +f ${bonus},- — Reputatie ${rep}!`,
      pickupDelivered: "Pakketje opgehaald — breng het naar de drop-zone",
      passengerIn: "Passagier ingestapt — breng ze naar de bestemming",
      // Verhaal hoofdstukken
      ch1Title: "Hoofdstuk 1 — Nieuw in de stad",
      ch1Line1: "Karimo stapt uit de trein met niets dan een tas en een adres op een papiertje.",
      ch1Line2: "Amsterdam ruikt anders 's nachts. Neon, regen, en beloftes die nog niemand heeft gebroken.",
      ch1Line3: "Een oude bekende, Vince, wacht bij de brug. Hij heeft werk — klein, om te beginnen.",
      ch1Outro: "Vince knikt goedkeurend. 'Niet slecht. Er is meer werk als je het aankan.'",
      ch2Title: "Hoofdstuk 2 — Vertrouwen winnen",
      ch2Line1: "Vince stelt Karimo voor aan Loes, die de garages aan de rand van de stad runt.",
      ch2Line2: "'Breng deze auto naar haar toe. Netjes, zonder krassen — dit is een test.'",
      ch2Outro: "Loes bekijkt de auto van top tot teen. 'Je kunt rijden. Goed om te weten.'",
      ch3Title: "Hoofdstuk 3 — De race",
      ch3Line1: "Er gaat een gerucht rond over een straatrace die elk weekend meer geld trekt.",
      ch3Line2: "Vince wil dat Karimo meedoet — niet voor de eer, maar om gezien te worden.",
      ch3Outro: "Karimo haalt de finish. De menigte kent zijn naam nu.",
      ch4Title: "Hoofdstuk 4 — Onder de radar",
      ch4Line1: "Iets ging mis bij de vorige klus. Er hangt nu politie rond die Karimo herkent.",
      ch4Line2: "'Blijf uit het zicht tot het stof neerdaalt,' zegt Vince. 'Dan praten we verder.'",
      ch4Outro: "De straten kalmeren. Karimo haalt adem — dit stadsleven vraagt veel.",
      ch5Title: "Hoofdstuk 5 — De oppositie",
      ch5Line1: "Een rivaliserende groep heeft een pand ingenomen dat van Vince' mensen was.",
      ch5Line2: "'Maak het gebied weer veilig,' zegt Vince. 'Laat zien dat we niet wegdrukken.'",
      ch5Outro: "Het pand is weer vrij. Vince belt Karimo met nieuws dat alles verandert.",
      ch6Title: "Hoofdstuk 6 — De laatste rit",
      ch6Line1: "Een belangrijk pakket moet vannacht nog de stad uit, voor het te laat is.",
      ch6Line2: "'Dit is de grote,' zegt Vince. 'Lever het af en je naam staat vast in deze stad.'",
      ch6Outro: "Karimo kijkt uit over de gracht terwijl de zon opkomt. Amsterdam voelt nu als thuis.",
      endingHeader: "— EINDE VAN HOOFDSTUK 1 VAN KARIMO'S VERHAAL —",
      endingStats: (rep, cash) => `Reputatie bereikt: ${rep}. Cash verdiend: f ${cash},-.`,
      endingFooter: "De straten van Amsterdam blijven open voor vrij spel. Nieuwe klussen duiken af en toe nog op.",
      // Winkels
      shopGarageTitle: "Garage",
      shopGarageSubtitle: "Spuit je auto of rust 'm uit — stap eerst in een auto.",
      shopClothingTitle: "Kledingzaak",
      shopClothingSubtitle: "Een nieuwe look voor Karimo.",
      shopWeaponsTitle: "Wapenhandel",
      shopWeaponsSubtitle: "Bewapening en munitie, geen vragen gesteld.",
      shopDealerTitle: "Autodealer",
      shopDealerSubtitle: "Een gloednieuwe auto, direct voor de deur.",
      itemPaintCyanName: "Spuitwerk — Neon Cyaan", itemPaintCyanDesc: "Verf je huidige auto cyaan.",
      itemPaintPinkName: "Spuitwerk — Neon Roze", itemPaintPinkDesc: "Verf je huidige auto roze.",
      itemPaintGoldName: "Spuitwerk — Goud", itemPaintGoldDesc: "Verf je huidige auto goud.",
      itemEngineName: "Motor-upgrade", itemEngineDesc: "Meer topsnelheid voor je huidige auto.",
      itemArmorName: "Pantserplaten", itemArmorDesc: "Je huidige auto overleeft meer rammen.",
      itemVestName: "Kogelvrij vest", itemVestDesc: "+25 max. gezondheid, permanent.",
      itemClassicName: "Classic roze jack", itemClassicDesc: "Het jack waarmee je begon.",
      itemCyanSuitName: "Cyaan pak", itemCyanSuitDesc: "Netjes gestoken voor de nacht.",
      itemGoldJacketName: "Gouden jack", itemGoldJacketDesc: "Opvallen is het doel.",
      itemBlackLeatherName: "Zwart leren jack", itemBlackLeatherDesc: "Voor als het menens wordt.",
      itemBuyPistolName: "Pistool", itemBuyPistolDesc: "Middelgrote schade, bespaart op munitie.",
      itemBuyUziName: "Uzi", itemBuyUziDesc: "Snelvuur, minder schade per schot.",
      itemAmmoPistolName: "Pistoolmunitie (+20)", itemAmmoPistolDesc: "Alleen te koop als je al een pistool hebt.",
      itemAmmoUziName: "Uzi-munitie (+60)", itemAmmoUziDesc: "Alleen te koop als je al een uzi hebt.",
      itemBuySedanName: "Sedan", itemBuySedanDesc: "Betrouwbaar en gebalanceerd.",
      itemBuySportName: "Sportwagen", itemBuySportDesc: "Sneller, maar kwetsbaarder bij botsingen.",
      itemBuyVanName: "Bestelwagen", itemBuyVanDesc: "Traag maar stevig, duwt dingen opzij.",
      // Flash messages
      newOutfit: (name) => `Nieuwe outfit: ${name}`,
      carPainted: "Auto gespoten!",
      engineUpgraded: "Motor verbeterd!",
      armorUpgraded: "Pantser aangebracht!",
      vestBought: "Kogelvrij vest gekocht!",
      weaponBought: (name) => `${name} gekocht!`,
      ammoBought: (amount) => `+ ${amount} munitie`,
      carDelivered: (name) => `${name} staat buiten klaar!`,
      plusHealth: "+ Gezondheid",
      plusPistolAmmo: "+ Pistoolmunitie",
      plusUziAmmo: "+ Uzi-munitie",
      plusCash: (amount) => `+ f ${amount},-`,
      pistolFound: "Pistool buitgemaakt!",
      uziFound: "Uzi buitgemaakt!",
      zoneLabelTank: "TANK",
      zoneLabelHeli: "HELIKOPTER",
      zoneLabelAirfield: "VLIEGVELD",
    },
    en: {
      titleCity: "AMSTERDAM, 1991",
      gameSubtitle: "A STORY OF KARIMO",
      playBtn: "START",
      titleHint: "Left: joystick to walk. Get in a car to drive.<br>Built for mobile &middot; fictional city, fictional story",
      weaponFist: "FISTS",
      weaponPistol: "PISTOL",
      weaponUzi: "UZI",
      repLabel: "REP",
      pwTitle: "Your free time is up",
      pwText: "You've played 30 free minutes of Vice Amsterdam. Buy one-time access now to keep playing forever — on this device.",
      pwBuyBtn: "Buy now",
      pwBuying: "One moment...",
      pwErrorStart: "Starting payment failed. Please try again.",
      pwErrorConnect: "Can't connect to the server. Please try again later.",
      btnEnter: "IN / OUT",
      btnBrake: "BRAKE",
      btnGas: "GAS",
      btnFire: "FIRE",
      btnSwitch: "SWITCH<br>WEAPON",
      interactHint: "Tap ENTER to go inside",
      storyTapHint: "tap to continue ▸",
      shopCloseBtn: "Close",
      modalBtn: "Retry",
      ownedBtn: "Active",
      getInCarBtn: "Get in a car",
      weaponNeededBtn: "Weapon needed",
      wearBtn: "Wear",
      caughtTitle: "Caught by the police",
      caughtText: "Karimo got arrested. You lose some of your cash.",
      shotTitle: "Karimo got shot",
      shotText: "You're taken to the hospital. You lose some cash.",
      cantExitAirborne: "You can't get out while airborne!",
      mTitleDelivery1: "Package delivery",
      mTextDelivery1: "Pick up the package at the marker and bring it to the drop-off zone.",
      mTitleRace1: "Street race",
      mTextRace1: "Drive a car to the finish before time runs out.",
      mTitleEscape1: "Lay low",
      mTextEscape1: "Lose your wanted level by staying out of police sight for 20 seconds.",
      mTitleTaxi1: "Taxi run",
      mTextTaxi1: "Pick up the passenger and drop them off at their destination.",
      mTitleSteal1: "Arrange a car",
      mTextSteal1: "Deliver a car to the marker for a client.",
      mTitleClear1: "Clear the area",
      mTextClear1: "Take out all marked targets.",
      mTitleSmuggle1: "Deliver weapons",
      mTextSmuggle1: "Pick up the shipment and get it to the buyer unseen.",
      mTitleVip1: "Protect the VIP",
      mTextVip1: "Pick up the VIP and get them away safely — drive calmly, don't draw attention.",
      missionBannerSide: "Side mission",
      missionBannerStory: "Main story",
      missionSucceeded: "Mission complete!",
      missionFailed: "Mission failed.",
      repUp: "Reputation",
      missionSuccessPlain: (bonus) => `Mission complete! +f ${bonus},-`,
      missionSuccessRep: (bonus, rep) => `Mission complete! +f ${bonus},- — Reputation ${rep}!`,
      pickupDelivered: "Package picked up — bring it to the drop-off zone",
      passengerIn: "Passenger aboard — take them to their destination",
      ch1Title: "Chapter 1 — New in town",
      ch1Line1: "Karimo steps off the train with nothing but a bag and an address on a scrap of paper.",
      ch1Line2: "Amsterdam smells different at night. Neon, rain, and promises nobody's broken yet.",
      ch1Line3: "An old acquaintance, Vince, waits by the bridge. He's got work — small, to start.",
      ch1Outro: "Vince nods approvingly. 'Not bad. There's more work if you can handle it.'",
      ch2Title: "Chapter 2 — Earning trust",
      ch2Line1: "Vince introduces Karimo to Loes, who runs the garages on the edge of town.",
      ch2Line2: "'Bring this car to her. Clean, no scratches — this is a test.'",
      ch2Outro: "Loes looks the car over top to bottom. 'You can drive. Good to know.'",
      ch3Title: "Chapter 3 — The race",
      ch3Line1: "Word's spreading about a street race pulling in more money every weekend.",
      ch3Line2: "Vince wants Karimo to join — not for the glory, but to be seen.",
      ch3Outro: "Karimo crosses the finish line. The crowd knows his name now.",
      ch4Title: "Chapter 4 — Under the radar",
      ch4Line1: "Something went wrong on the last job. There's police around now who recognize Karimo.",
      ch4Line2: "'Stay out of sight till the dust settles,' Vince says. 'Then we'll talk.'",
      ch4Outro: "The streets calm down. Karimo catches his breath — this city life asks a lot.",
      ch5Title: "Chapter 5 — The opposition",
      ch5Line1: "A rival crew has taken over a building that used to belong to Vince's people.",
      ch5Line2: "'Make the area safe again,' Vince says. 'Show them we don't get pushed out.'",
      ch5Outro: "The building's clear again. Vince calls Karimo with news that changes everything.",
      ch6Title: "Chapter 6 — The last run",
      ch6Line1: "An important package needs to leave the city tonight, before it's too late.",
      ch6Line2: "'This is the big one,' Vince says. 'Deliver it and your name's set in this city.'",
      ch6Outro: "Karimo looks out over the canal as the sun comes up. Amsterdam finally feels like home.",
      endingHeader: "— END OF CHAPTER 1 OF KARIMO'S STORY —",
      endingStats: (rep, cash) => `Reputation reached: ${rep}. Cash earned: f ${cash},-.`,
      endingFooter: "Amsterdam's streets stay open for free play. New jobs still pop up now and then.",
      shopGarageTitle: "Garage",
      shopGarageSubtitle: "Paint your car or upgrade it — get in a car first.",
      shopClothingTitle: "Clothing store",
      shopClothingSubtitle: "A new look for Karimo.",
      shopWeaponsTitle: "Gun shop",
      shopWeaponsSubtitle: "Weapons and ammo, no questions asked.",
      shopDealerTitle: "Car dealer",
      shopDealerSubtitle: "A brand new car, delivered right to you.",
      itemPaintCyanName: "Paint job — Neon Cyan", itemPaintCyanDesc: "Paint your current car cyan.",
      itemPaintPinkName: "Paint job — Neon Pink", itemPaintPinkDesc: "Paint your current car pink.",
      itemPaintGoldName: "Paint job — Gold", itemPaintGoldDesc: "Paint your current car gold.",
      itemEngineName: "Engine upgrade", itemEngineDesc: "More top speed for your current car.",
      itemArmorName: "Armor plating", itemArmorDesc: "Your current car survives more ramming.",
      itemVestName: "Bulletproof vest", itemVestDesc: "+25 max health, permanent.",
      itemClassicName: "Classic pink jacket", itemClassicDesc: "The jacket you started with.",
      itemCyanSuitName: "Cyan suit", itemCyanSuitDesc: "Dressed up for the night.",
      itemGoldJacketName: "Gold jacket", itemGoldJacketDesc: "Standing out is the point.",
      itemBlackLeatherName: "Black leather jacket", itemBlackLeatherDesc: "For when things get serious.",
      itemBuyPistolName: "Pistol", itemBuyPistolDesc: "Medium damage, saves on ammo.",
      itemBuyUziName: "Uzi", itemBuyUziDesc: "Rapid fire, less damage per shot.",
      itemAmmoPistolName: "Pistol ammo (+20)", itemAmmoPistolDesc: "Only buyable if you already own a pistol.",
      itemAmmoUziName: "Uzi ammo (+60)", itemAmmoUziDesc: "Only buyable if you already own an uzi.",
      itemBuySedanName: "Sedan", itemBuySedanDesc: "Reliable and balanced.",
      itemBuySportName: "Sports car", itemBuySportDesc: "Faster, but more fragile in crashes.",
      itemBuyVanName: "Van", itemBuyVanDesc: "Slow but sturdy, shoves things aside.",
      newOutfit: (name) => `New outfit: ${name}`,
      carPainted: "Car painted!",
      engineUpgraded: "Engine upgraded!",
      armorUpgraded: "Armor fitted!",
      vestBought: "Bulletproof vest bought!",
      weaponBought: (name) => `${name} bought!`,
      ammoBought: (amount) => `+ ${amount} ammo`,
      carDelivered: (name) => `${name} is parked outside!`,
      plusHealth: "+ Health",
      plusPistolAmmo: "+ Pistol ammo",
      plusUziAmmo: "+ Uzi ammo",
      plusCash: (amount) => `+ f ${amount},-`,
      pistolFound: "Picked up a pistol!",
      uziFound: "Picked up an uzi!",
      zoneLabelTank: "TANK",
      zoneLabelHeli: "HELICOPTER",
      zoneLabelAirfield: "AIRFIELD",
    },
  };

  let currentLang = localStorage.getItem("va_lang") || "nl";

  function t(key, ...args) {
    const entry = (I18N[currentLang] && I18N[currentLang][key] !== undefined)
      ? I18N[currentLang][key]
      : I18N.nl[key];
    if (typeof entry === "function") return entry(...args);
    return entry !== undefined ? entry : key;
  }

  function applyLanguageToDOM() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = t(key);
      // Elementen waarvan de bronstring een <br> bevat moeten als HTML
      // gezet worden, de rest blijft platte tekst (veiliger, geen
      // ongewenste HTML-injectie uit vertaalstrings die geen <br> hebben).
      if (val.includes("<br>")) el.innerHTML = val;
      else el.textContent = val;
    });
    const langBtn = document.getElementById("langBtn");
    const langBtnTitle = document.getElementById("langBtnTitle");
    const otherLangLabel = currentLang === "nl" ? "EN" : "NL";
    if (langBtn) langBtn.textContent = otherLangLabel;
    if (langBtnTitle) langBtnTitle.textContent = otherLangLabel;
  }

  function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem("va_lang", lang);
    applyLanguageToDOM();
    // Dynamische labels die niet via data-i18n lopen, opnieuw tekenen:
    refreshWeaponChips();
    if (shopOpen && nearShop) renderShopItems(nearShop);
  }

  function toggleLanguage() {
    setLanguage(currentLang === "nl" ? "en" : "nl");
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

  // Bruggen op gekozen kruisingen met het stratenraster (niet elke kruising —
  // dat oogt natuurlijker, net als in de echte grachtengordel), plus bomen
  // langs de kades voor het klassieke Amsterdamse gracht-silhouet.
  const CANAL_BRIDGES = [];
  const CANAL_TREES = [];
  (function buildCanalDecor() {
    const rng = mulberry32(3344);
    const bs = WORLD.blockSize;
    for (const s of CANAL.strips) {
      if (s.vertical) {
        for (let y = bs / 2; y < WORLD.size; y += bs) {
          if (rng() < 0.55) {
            CANAL_BRIDGES.push({ x: s.x, y, vertical: true, w: s.w + 26 });
          }
        }
        // bomen in rijtjes langs beide kades
        for (let y = 60; y < WORLD.size; y += 70 + rng() * 30) {
          CANAL_TREES.push({ x: s.x - s.w / 2 - 20, y: y + rng() * 20, sway: rng() * Math.PI * 2 });
          CANAL_TREES.push({ x: s.x + s.w / 2 + 20, y: y + rng() * 20, sway: rng() * Math.PI * 2 });
        }
      } else {
        for (let x = bs / 2; x < WORLD.size; x += bs) {
          if (rng() < 0.55) {
            CANAL_BRIDGES.push({ x, y: s.y, vertical: false, w: s.h + 26 });
          }
        }
        for (let x = 60; x < WORLD.size; x += 70 + rng() * 30) {
          CANAL_TREES.push({ x: x + rng() * 20, y: s.y - s.h / 2 - 20, sway: rng() * Math.PI * 2 });
          CANAL_TREES.push({ x: x + rng() * 20, y: s.y + s.h / 2 + 20, sway: rng() * Math.PI * 2 });
        }
      }
    }
  })();

  const NEON_WORDS = [
    "CAFE", "BAR DE NACHT", "HOTEL", "GRAND", "CASA", "CLUB 91",
    "FRITUUR", "NEON", "DISCO", "PARKING", "APOTHEEK", "SNACK",
  ];

  // Speciale-voertuig zones, verspreid over de hele wereld in plaats van
  // op één vaste plek — gedefinieerd vóór gebouwgeneratie zodat we die
  // plekken vrij kunnen houden van bebouwing.
  const specialRng = mulberry32(8123);
  function scatterPoint(minD, maxD) {
    // Verspreid over de hele kaart, met wat marge tot de rand
    const margin = 300;
    return {
      x: margin + specialRng() * (3200 - margin * 2),
      y: margin + specialRng() * (3200 - margin * 2),
    };
  }
  const TANK_SPAWNS = [scatterPoint(), scatterPoint(), scatterPoint()];
  const HELI_SPAWNS = [scatterPoint(), scatterPoint(), scatterPoint()];
  // Vliegtuigen hebben een echte start-/landingsbaan nodig, dus die blijven
  // aan vaste, verspreide vliegvelden gebonden (2 stuks i.p.v. 1).
  const AIRFIELDS = [
    { x: 700, y: 2600, runwayLen: 520, angle: 0 },
    { x: 2500, y: 700, runwayLen: 520, angle: Math.PI / 2 },
  ];
  const SPECIAL_ZONE_CLEAR_RADIUS = 150;

  function inAnySpecialZone(x, y, margin) {
    for (const p of TANK_SPAWNS) if (Math.hypot(x - p.x, y - p.y) < SPECIAL_ZONE_CLEAR_RADIUS + margin) return true;
    for (const p of HELI_SPAWNS) if (Math.hypot(x - p.x, y - p.y) < SPECIAL_ZONE_CLEAR_RADIUS + margin) return true;
    for (const a of AIRFIELDS) {
      const dx = x - a.x, dy = y - a.y;
      // ruwe rechthoekige vrije zone rond elke startbaan, rekening houdend met de hoek
      const along = dx * Math.cos(a.angle) + dy * Math.sin(a.angle);
      const across = -dx * Math.sin(a.angle) + dy * Math.cos(a.angle);
      if (Math.abs(along) < a.runwayLen / 2 + margin && Math.abs(across) < 90 + margin) return true;
    }
    return false;
  }

  const BUILDINGS = [];
  // Amsterdamse baksteen/gevel-kleurenpalet — warme bruin/rood/okertinten
  // i.p.v. de generieke paarse neon-tint, met hier en daar een lichte
  // pleister-gevel voor afwisseling (klassiek Amsterdams straatbeeld).
  const BRICK_PALETTE = [
    { h: 14, s: 42 }, // baksteenrood
    { h: 28, s: 38 }, // okerbruin
    { h: 8,  s: 34 }, // donkere terracotta
    { h: 40, s: 24 }, // gebroken wit pleisterwerk
    { h: 350, s: 30 }, // oudroze gevel
  ];

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
        if (inAnySpecialZone(cx, cy, 0)) continue;
        const pad = rw / 2 + 14;
        const blockW = bs - pad * 2 - rng() * 20;
        const blockH = bs - pad * 2 - rng() * 20;
        if (blockW < 40 || blockH < 40) continue;

        const nearCanal = inAnyCanal(cx, cy, 240);
        // Grachtenpanden: smal en hoog. We knippen het blok op in 2-4 smalle
        // panden naast elkaar in plaats van één brede gevel — dat smalle,
        // hoge silhouet is hét herkenbare Amsterdamse straatbeeld.
        const wantsRowhouses = nearCanal ? rng() < 0.85 : rng() < 0.35;
        const panelCount = wantsRowhouses ? (2 + Math.floor(rng() * 3)) : 1;
        const panelW = blockW / panelCount;

        for (let p = 0; p < panelCount; p++) {
          const bw = panelW - 3 - rng() * 4; // dun voegje tussen panden
          const bh = blockH - rng() * 14;
          if (bw < 20 || bh < 40) continue;
          const palette = BRICK_PALETTE[Math.floor(rng() * BRICK_PALETTE.length)];
          const roofKind = rng() < 0.5 ? "pink" : "cyan";
          const storeyH = 15 + rng() * 5;
          const storeys = Math.max(2, Math.floor((bh * 0.78) / storeyH));
          const hasAwning = rng() < (nearCanal ? 0.2 : 0.4);
          const hasNeon = rng() < (nearCanal ? 0.12 : 0.3);
          const heightTier = rng() < 0.2 ? 3 : (rng() < 0.5 ? 2 : 1);
          // Trapgevel: alleen bij smalle, hoge grachtenpanden — brede moderne
          // gebouwen houden een platte kroonlijst.
          const isNarrowTall = bw < 75 && bh / bw > 1.1;
          const hasStepGable = isNarrowTall && rng() < 0.7;
          const gableSteps = hasStepGable ? (2 + Math.floor(rng() * 3)) : 0;

          BUILDINGS.push({
            x: bx + pad + p * panelW,
            y: by + pad + (blockH - bh),
            w: bw,
            h: bh,
            baseColor: `hsl(${palette.h}, ${palette.s}%, ${(28 + rng() * 10).toFixed(0)}%)`,
            trimColor: `hsl(${palette.h}, ${palette.s - 8}%, ${(16 + rng() * 6).toFixed(0)}%)`,
            mortarColor: `hsl(${palette.h}, ${Math.max(10, palette.s - 20)}%, ${(12 + rng() * 5).toFixed(0)}%)`,
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
            hasStepGable,
            gableSteps,
            trimAccent: rng() < 0.5, // witte gevelband zoals bij echte grachtenpanden
          });
        }
      }
    }
  })();

  // Let op: grachten blokkeren beweging niet (dat was al zo vóór de
  // Amsterdam-visuals) — inAnyCanal wordt alleen gebruikt om plaatsing van
  // gebouwen/auto's/pickups uit het water te houden. De bruggen hieronder
  // zijn dus decoratief, geen functionele oversteekpunten.
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

  // Verschillende gewone voertuigtypes — elk met een eigen formaat en rijgevoel
  const CAR_TYPES = {
    sedan: { w: 34, h: 18, topSpeed: 340, accel: 220, weight: 1 },
    sport: { w: 32, h: 16, topSpeed: 420, accel: 300, weight: 0.85 },
    van:   { w: 38, h: 21, topSpeed: 260, accel: 160, weight: 1.4 },
  };
  const CAR_TYPE_WEIGHTS = [
    ["sedan", 0.6], ["sport", 0.22], ["van", 0.18],
  ];
  function pickCarType(rng) {
    const r = rng();
    let acc = 0;
    for (const [type, w] of CAR_TYPE_WEIGHTS) {
      acc += w;
      if (r <= acc) return type;
    }
    return "sedan";
  }

  const cars = [];
  (function scatterCars() {
    const rng = mulberry32(42);
    for (let i = 0; i < 64; i++) {
      let x, y, tries = 0;
      do {
        x = rng() * WORLD.size;
        y = rng() * WORLD.size;
        tries++;
      } while ((collidesBuilding(x, y, 40) || inAnyCanal(x, y, 20)) && tries < 20);
      const carType = pickCarType(rng);
      const stats = CAR_TYPES[carType];
      cars.push({
        x, y,
        angle: Math.floor(rng() * 4) * (Math.PI / 2),
        color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
        w: stats.w, h: stats.h,
        carType,
        topSpeed: stats.topSpeed,
        accel: stats.accel,
        weight: stats.weight,
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
  // Speciale voertuigen: tanks en helikopters staan verspreid over de hele
  // stad (zoals gewone auto's); vliegtuigen staan aan vaste, verspreide
  // vliegvelden omdat ze een startbaan nodig hebben om op te stijgen.
  // ---------------------------------------------------------
  function makeTank(spawn) {
    return {
      kind: "tank",
      x: spawn.x, y: spawn.y,
      angle: 0, speed: 0,
      turretAngle: 0,
      w: 46, h: 30,
      topSpeed: 140, accel: 90, weight: 3.2,
      health: 400, maxHealth: 400,
      occupied: false,
      fireCooldown: 0,
    };
  }
  function makeHelicopter(spawn) {
    return {
      kind: "helicopter",
      x: spawn.x, y: spawn.y,
      angle: -Math.PI / 2, speed: 0,
      altitude: 0, maxAltitude: 1, // 0 = geland, 1 = volledig in de lucht
      w: 40, h: 40,
      topSpeed: 480,
      occupied: false,
      rotorSpin: 0,
    };
  }
  function makePlane(airfield) {
    return {
      kind: "plane",
      x: airfield.x - Math.cos(airfield.angle) * (airfield.runwayLen / 2 - 40),
      y: airfield.y - Math.sin(airfield.angle) * (airfield.runwayLen / 2 - 40),
      angle: airfield.angle, speed: 0,
      altitude: 0, maxAltitude: 1,
      w: 52, h: 46,
      topSpeed: 620,
      minFlightSpeed: 260, // onder deze snelheid kan hij niet opstijgen/blijft hij dalen
      occupied: false,
      homeAirfield: airfield,
    };
  }

  const tanks = TANK_SPAWNS.map(makeTank);
  const helicopters = HELI_SPAWNS.map(makeHelicopter);
  const planes = AIRFIELDS.map(makePlane);
  const specialVehicles = [...tanks, ...helicopters, ...planes];

  // ---------------------------------------------------------
  // Garages & clothing shops (world locations the player walks into)
  // ---------------------------------------------------------
  const SHOP_CATALOGS = {
    garage: [
      { id: "paint_cyan", nameKey: "itemPaintCyanName", descKey: "itemPaintCyanDesc", price: 80, kind: "paint", value: "#2ee6ff" },
      { id: "paint_pink", nameKey: "itemPaintPinkName", descKey: "itemPaintPinkDesc", price: 80, kind: "paint", value: "#ff2e8e" },
      { id: "paint_gold", nameKey: "itemPaintGoldName", descKey: "itemPaintGoldDesc", price: 120, kind: "paint", value: "#ffe14d" },
      { id: "engine1", nameKey: "itemEngineName", descKey: "itemEngineDesc", price: 220, kind: "engine_upgrade" },
      { id: "armor1", nameKey: "itemArmorName", descKey: "itemArmorDesc", price: 180, kind: "armor_upgrade" },
      { id: "vest1", nameKey: "itemVestName", descKey: "itemVestDesc", price: 300, kind: "vest" },
    ],
    clothing: [
      { id: "classic", nameKey: "itemClassicName", descKey: "itemClassicDesc", price: 0, kind: "outfit", value: "#ff2e8e" },
      { id: "cyan_suit", nameKey: "itemCyanSuitName", descKey: "itemCyanSuitDesc", price: 150, kind: "outfit", value: "#2ee6ff" },
      { id: "gold_jacket", nameKey: "itemGoldJacketName", descKey: "itemGoldJacketDesc", price: 260, kind: "outfit", value: "#ffe14d" },
      { id: "black_leather", nameKey: "itemBlackLeatherName", descKey: "itemBlackLeatherDesc", price: 200, kind: "outfit", value: "#2a1f3d" },
    ],
    weapons: [
      { id: "buy_pistol", nameKey: "itemBuyPistolName", descKey: "itemBuyPistolDesc", price: 350, kind: "weapon_unlock", value: "pistol" },
      { id: "buy_uzi", nameKey: "itemBuyUziName", descKey: "itemBuyUziDesc", price: 700, kind: "weapon_unlock", value: "uzi" },
      { id: "ammo_pistol", nameKey: "itemAmmoPistolName", descKey: "itemAmmoPistolDesc", price: 60, kind: "ammo", value: "pistol", amount: 20 },
      { id: "ammo_uzi", nameKey: "itemAmmoUziName", descKey: "itemAmmoUziDesc", price: 90, kind: "ammo", value: "uzi", amount: 60 },
    ],
    dealer: [
      { id: "buy_sedan", nameKey: "itemBuySedanName", descKey: "itemBuySedanDesc", price: 400, kind: "buy_car", value: "sedan" },
      { id: "buy_sport", nameKey: "itemBuySportName", descKey: "itemBuySportDesc", price: 900, kind: "buy_car", value: "sport" },
      { id: "buy_van", nameKey: "itemBuyVanName", descKey: "itemBuyVanDesc", price: 600, kind: "buy_car", value: "van" },
    ],
  };

  const shops = [];
  (function placeShops() {
    const rng = mulberry32(5150);
    const kinds = ["garage", "clothing", "weapons", "dealer"];
    for (let i = 0; i < 12; i++) {
      const kind = kinds[i % 4];
      const spot = randomSpotNearFn(rng, WORLD.size / 2, WORLD.size / 2, 200, 1400);
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
  // Fietsers — puur sfeerdecor, geen gameplay-interactie (geen schade,
  // geen wanted-level, geen botsing). Zwenken rustig over straat en keren
  // om aan de rand van de wereld.
  // ---------------------------------------------------------
  const cyclists = [];
  (function scatterCyclists() {
    const rng = mulberry32(2026);
    for (let i = 0; i < 16; i++) {
      let x, y, tries = 0;
      do {
        x = rng() * WORLD.size;
        y = rng() * WORLD.size;
        tries++;
      } while (collidesBuilding(x, y, 20) && tries < 20);
      cyclists.push({
        x, y,
        angle: Math.floor(rng() * 4) * (Math.PI / 2),
        speed: 55 + rng() * 25,
        pedalPhase: rng() * Math.PI * 2,
        frameColor: ["#1a1a1a", "#2e2e2e", "#3a2a1a"][Math.floor(rng() * 3)],
        riderColor: ["#ff2e8e", "#2ee6ff", "#ffe14d", "#8a5cff", "#5dff7a"][Math.floor(rng() * 5)],
      });
    }
  })();

  function updateCyclists(dt) {
    for (const cy of cyclists) {
      cy.pedalPhase += dt * 8;
      const nx = cy.x + Math.cos(cy.angle) * cy.speed * dt;
      const ny = cy.y + Math.sin(cy.angle) * cy.speed * dt;
      if (!collidesBuilding(nx, cy.y, 10) && nx > 0 && nx < WORLD.size) cy.x = nx;
      else cy.angle = Math.PI - cy.angle + (Math.random() - 0.5) * 0.4;
      if (!collidesBuilding(cy.x, ny, 10) && ny > 0 && ny < WORLD.size) cy.y = ny;
      else cy.angle = -cy.angle + (Math.random() - 0.5) * 0.4;
      // zo nu en dan een klein beetje van richting veranderen voor natuurlijker gedrag
      if (Math.random() < dt * 0.15) cy.angle += (Math.random() - 0.5) * 0.6;
    }
  }

  function drawCyclists() {
    const r = visibleWorldRect();
    for (const cy of cyclists) {
      if (cy.x < r.x0 || cy.x > r.x1 || cy.y < r.y0 || cy.y > r.y1) continue;
      ctx.save();
      ctx.translate(cy.x, cy.y);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(1.5, 2, 9, 4, 0, 0, Math.PI * 2); ctx.fill();

      ctx.rotate(cy.angle);
      // wielen (licht bewegend voor pedaal-indruk)
      const wobble = Math.sin(cy.pedalPhase) * 0.5;
      ctx.strokeStyle = cy.frameColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-6, 0, 3.2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(6, 0, 3.2, 0, Math.PI * 2); ctx.stroke();
      // frame
      ctx.strokeStyle = cy.frameColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.lineTo(0, -3); ctx.lineTo(6, 0);
      ctx.moveTo(0, -3); ctx.lineTo(-1, 0.5 + wobble);
      ctx.stroke();
      // berijder — simpel silhouet
      ctx.fillStyle = cy.riderColor;
      ctx.beginPath(); ctx.arc(-1, -6, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8b48c";
      ctx.beginPath(); ctx.arc(-1, -9.5, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
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
      titleKey: "mTitleDelivery1",
      textKey: "mTextDelivery1",
      type: "fetch-deliver",
      reward: 300,
    },
    {
      id: "race1",
      titleKey: "mTitleRace1",
      textKey: "mTextRace1",
      type: "race",
      reward: 400,
      timeLimit: 55,
    },
    {
      id: "escape1",
      titleKey: "mTitleEscape1",
      textKey: "mTextEscape1",
      type: "lose-heat",
      reward: 200,
    },
    {
      id: "taxi1",
      titleKey: "mTitleTaxi1",
      textKey: "mTextTaxi1",
      type: "taxi",
      reward: 250,
    },
    {
      id: "steal1",
      titleKey: "mTitleSteal1",
      textKey: "mTextSteal1",
      type: "steal-car",
      reward: 350,
    },
    {
      id: "clear1",
      titleKey: "mTitleClear1",
      textKey: "mTextClear1",
      type: "clear-targets",
      reward: 450,
    },
    {
      id: "smuggle1",
      titleKey: "mTitleSmuggle1",
      textKey: "mTextSmuggle1",
      type: "fetch-deliver",
      reward: 420,
    },
    {
      id: "vip1",
      titleKey: "mTitleVip1",
      textKey: "mTextVip1",
      type: "taxi",
      reward: 380,
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
      titleKey: "ch1Title",
      introKeys: ["ch1Line1", "ch1Line2", "ch1Line3"],
      type: "fetch-deliver",
      reward: 350,
      outroKey: "ch1Outro",
    },
    {
      titleKey: "ch2Title",
      introKeys: ["ch2Line1", "ch2Line2"],
      type: "steal-car",
      reward: 420,
      outroKey: "ch2Outro",
    },
    {
      titleKey: "ch3Title",
      introKeys: ["ch3Line1", "ch3Line2"],
      type: "race",
      reward: 500,
      timeLimit: 60,
      outroKey: "ch3Outro",
    },
    {
      titleKey: "ch4Title",
      introKeys: ["ch4Line1", "ch4Line2"],
      type: "lose-heat",
      reward: 380,
      outroKey: "ch4Outro",
    },
    {
      titleKey: "ch5Title",
      introKeys: ["ch5Line1", "ch5Line2"],
      type: "clear-targets",
      reward: 600,
      outroKey: "ch5Outro",
    },
    {
      titleKey: "ch6Title",
      introKeys: ["ch6Line1", "ch6Line2"],
      type: "fetch-deliver",
      reward: 900,
      outroKey: "ch6Outro",
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
    showStoryDialogueTracked(def.introKeys.map((k) => t(k)), () => {
      beginStoryMissionPlay(def);
    });
    return true;
  }

  function beginStoryMissionPlay(def) {
    currentMission = def;
    missionState = "active";
    showMissionBanner(t(def.titleKey), t("missionBannerStory"));
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
    showMissionBanner(t(def.titleKey), t(def.textKey));
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
        flashMessage(t("missionSuccessRep", bonus, player.reputation));
      } else {
        flashMessage(t("missionSuccessPlain", bonus));
      }
      sfx("mission");
      if (wasStory) {
        player.storyStage++;
        player.reputation++;
      }
    } else if (currentMission) {
      flashMessage(t("missionFailed"));
    }
    currentMission = null;
    missionMarker = null;
    missionTargets = [];
    missionCarRef = null;
    missionState = "none";
    missionCooldown = 3 + Math.random() * 3;
    hideMissionBanner();

    if (success && wasStory && finishedDef && finishedDef.outro) {
      const isFinalChapter = player.storyStage >= STORY_MISSIONS.length;
      showStoryDialogueTracked([finishedDef.outro], isFinalChapter ? showEndingScreen : null);
      missionCooldown = isFinalChapter ? 999999 : 6; // geen nieuwe missies meer na het einde
    }
    storyActive = false;
  }

  function showEndingScreen() {
    showStoryDialogueTracked([
      "— EINDE VAN HOOFDSTUK 1 VAN KARIMO'S VERHAAL —",
      `Reputatie bereikt: ${player.reputation}. Cash verdiend: f ${Math.floor(player.cash)},-.`,
      "De straten van Amsterdam blijven open voor vrij spel. Nieuwe klussen duiken af en toe nog op.",
    ], () => {
      // Na het einde vallen we terug op gewone side-missies, geen cooldown-lock meer
      missionCooldown = 4 + Math.random() * 4;
    });
  }

  function flashMessage(text) {
    const b = document.getElementById("missionBanner");
    const titleEl = document.getElementById("mbTitle");
    const d = document.getElementById("mbText");
    titleEl.textContent = text;
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
    garage: { titleKey: "shopGarageTitle", subtitleKey: "shopGarageSubtitle" },
    clothing: { titleKey: "shopClothingTitle", subtitleKey: "shopClothingSubtitle" },
    weapons: { titleKey: "shopWeaponsTitle", subtitleKey: "shopWeaponsSubtitle" },
    dealer: { titleKey: "shopDealerTitle", subtitleKey: "shopDealerSubtitle" },
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
    shopTitle.textContent = t(meta.titleKey);
    shopSubtitle.textContent = t(meta.subtitleKey);
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
      name.textContent = t(item.nameKey);
      const desc = document.createElement("div");
      desc.className = "shop-item-desc";
      desc.textContent = t(item.descKey);
      info.appendChild(name);
      info.appendChild(desc);

      const btn = document.createElement("button");
      btn.className = "shop-buy-btn";

      const owned = isItemOwned(item);
      const needsCar = (item.kind === "paint" || item.kind === "engine_upgrade" || item.kind === "armor_upgrade");
      const carMissing = needsCar && !player.inCar;
      const ammoBlocked = isAmmoBlocked(item);

      if (owned) {
        btn.textContent = t("ownedBtn");
        btn.classList.add("owned");
        btn.disabled = true;
      } else if (carMissing) {
        btn.textContent = t("getInCarBtn");
        btn.disabled = true;
      } else if (ammoBlocked) {
        btn.textContent = t("weaponNeededBtn");
        btn.disabled = true;
      } else if (player.cash < item.price) {
        btn.textContent = `f ${item.price},-`;
        btn.disabled = true;
      } else {
        btn.textContent = item.price === 0 ? t("wearBtn") : `f ${item.price},-`;
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
    if (item.kind === "weapon_unlock") return player.weapons[item.value];
    // ammo is nooit "owned" — altijd opnieuw koopbaar, behalve als het wapen nog mist
    return false;
  }

  function isAmmoBlocked(item) {
    return item.kind === "ammo" && !player.weapons[item.value];
  }

  function purchaseItem(item) {
    if (item.price > 0) {
      if (player.cash < item.price) return;
      player.cash -= item.price;
    }
    sfx("pickup");
    const itemName = t(item.nameKey);
    if (item.kind === "outfit") {
      player.jacketColor = item.value;
      if (!player.ownedOutfits.includes(item.id)) player.ownedOutfits.push(item.id);
      flashMessage(t("newOutfit", itemName));
    } else if (item.kind === "paint" && player.inCar) {
      player.inCar.color = item.value;
      flashMessage(t("carPainted"));
    } else if (item.kind === "engine_upgrade" && player.inCar) {
      player.inCar.upgradedEngine = true;
      flashMessage(t("engineUpgraded"));
    } else if (item.kind === "armor_upgrade" && player.inCar) {
      player.inCar.upgradedArmor = true;
      flashMessage(t("armorUpgraded"));
    } else if (item.kind === "vest") {
      player.maxHealthBonus = 25;
      player.health = Math.min(100 + player.maxHealthBonus, player.health + 25);
      flashMessage(t("vestBought"));
    } else if (item.kind === "weapon_unlock") {
      player.weapons[item.value] = true;
      player.ammo[item.value] += item.value === "pistol" ? 12 : 40;
      player.currentWeapon = item.value;
      refreshWeaponChips();
      flashMessage(t("weaponBought", itemName));
    } else if (item.kind === "ammo") {
      player.ammo[item.value] += item.amount;
      flashMessage(t("ammoBought", item.amount));
    } else if (item.kind === "buy_car") {
      const stats = CAR_TYPES[item.value];
      const spot = randomSpotNear(player.x, player.y, 40, 90);
      cars.push({
        x: spot.x, y: spot.y,
        angle: 0,
        color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
        w: stats.w, h: stats.h,
        carType: item.value,
        topSpeed: stats.topSpeed,
        accel: stats.accel,
        weight: stats.weight,
        speed: 0,
        occupied: false,
        isPolice: false,
      });
      flashMessage(t("carDelivered", itemName));
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
    document.getElementById("langBtn").style.display = "flex";
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
    if (player.inCar) player.inCar.occupied = false;
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
        const v = player.inCar;
        const isAirborne = (v.kind === "helicopter" || v.kind === "plane") && v.altitude > 0.05;
        if (isAirborne) {
          flashMessage(t("cantExitAirborne"));
        } else {
          v.occupied = false;
          player.x = v.x + Math.cos(v.angle + Math.PI / 2) * (v.w * 0.7);
          player.y = v.y + Math.sin(v.angle + Math.PI / 2) * (v.w * 0.7);
          player.inCar = null;
        }
      } else {
        // find nearest vehicle in range — gewone auto's of een speciaal voertuig
        let best = null, bestD = 55;
        for (const c of cars) {
          if (c.occupied) continue;
          const d = Math.hypot(c.x - player.x, c.y - player.y);
          if (d < bestD) { bestD = d; best = c; }
        }
        for (const v of specialVehicles) {
          if (v.occupied) continue;
          const d = Math.hypot(v.x - player.x, v.y - player.y);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best) {
          best.occupied = true;
          player.inCar = best;
        }
      }
    }

    if (player.inCar) {
      const v = player.inCar;
      if (v.kind === "tank") updateTankPhysics(v, dt);
      else if (v.kind === "helicopter") updateHelicopterPhysics(v, dt);
      else if (v.kind === "plane") updatePlanePhysics(v, dt);
      else updateCarPhysics(v, dt, true);
      player.x = v.x;
      player.y = v.y;
    } else {
      updatePlayerWalk(dt);
    }

    updateWeaponSwitch();
    updateCombat(dt);
    updatePolice(dt);
    updateWanted(dt);
    updateMission(dt);
    updatePedestrians(dt);
    updateCyclists(dt);
    updateBullets(dt);
    updatePickups();
    updateShopProximity();
    updateCamera();
    worldTime += dt;

    if (player.health <= 0 && !gameOver) {
      showGameOverModal(t("shotTitle"), t("shotText"));
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
          flashMessage(t("plusHealth"));
        } else if (p.kind === "pistol_ammo") {
          player.ammo.pistol += p.amount;
          flashMessage(t("plusPistolAmmo"));
        } else if (p.kind === "uzi_ammo") {
          player.ammo.uzi += p.amount;
          flashMessage(t("plusUziAmmo"));
        } else if (p.kind === "cash") {
          player.cash += p.amount;
          flashMessage(t("plusCash", p.amount));
        } else if (p.kind === "weapon_pistol") {
          player.weapons.pistol = true;
          player.ammo.pistol += 12;
          player.currentWeapon = "pistol";
          refreshWeaponChips();
          flashMessage(t("pistolFound"));
        } else if (p.kind === "weapon_uzi") {
          player.weapons.uzi = true;
          player.ammo.uzi += 40;
          player.currentWeapon = "uzi";
          refreshWeaponChips();
          flashMessage(t("uziFound"));
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
    const turnSpeed = 2.4 / (car.weight || 1);
    const baseTop = car.topSpeed || 340;
    const baseAccel = car.accel || 220;
    const topSpeed = car.upgradedEngine ? baseTop * 1.26 : baseTop;
    const accel = car.upgradedEngine ? baseAccel * 1.27 : baseAccel;
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

  function updateTankPhysics(tankV, dt) {
    const turnSpeed = 1.4; // zwaarder en trager te sturen dan een auto
    const steer = input.moveX;
    if (input.gas) tankV.speed = Math.min(tankV.speed + tankV.accel * dt, tankV.topSpeed);
    else if (input.brake) tankV.speed = Math.max(tankV.speed - 150 * dt, -tankV.topSpeed * 0.4);
    else tankV.speed *= (1 - Math.min(1, 0.9 * dt));
    if (Math.abs(tankV.speed) < 2) tankV.speed = 0;

    if (Math.abs(tankV.speed) > 3) {
      tankV.angle += steer * turnSpeed * dt * Math.sign(tankV.speed || 1) * 0.5;
    }
    tankV.turretAngle = tankV.angle; // toren richt mee met rijrichting (eenvoudig model)

    const nx = tankV.x + Math.cos(tankV.angle) * tankV.speed * dt;
    const ny = tankV.y + Math.sin(tankV.angle) * tankV.speed * dt;
    // Tanks zijn zwaar genoeg om niet terug te stuiteren op gebouwen — ze stoppen gewoon
    if (!collidesBuilding(nx, tankV.y, 24)) tankV.x = nx; else tankV.speed *= 0.1;
    if (!collidesBuilding(tankV.x, ny, 24)) tankV.y = ny; else tankV.speed *= 0.1;
    clampToWorld(tankV);

    // Kanon afvuren
    tankV.fireCooldown -= dt;
    if (input.fire && tankV.fireCooldown <= 0) {
      tankV.fireCooldown = 1.1;
      sfx("shot");
      bullets.push({
        x: tankV.x + Math.cos(tankV.angle) * 30,
        y: tankV.y + Math.sin(tankV.angle) * 30,
        angle: tankV.angle,
        speed: 480,
        damage: 60,
        life: 0.9,
        fromPlayer: true,
        isShell: true,
      });
    }

    // Tank rijdt gewone auto's/voetgangers aan diggelen bij contact op snelheid
    if (Math.abs(tankV.speed) > 50) {
      for (const pd of pedestrians) {
        if (!pd.alive) continue;
        if (Math.hypot(pd.x - tankV.x, pd.y - tankV.y) < 28) {
          pd.alive = false;
          player.wanted = Math.min(5, player.wanted + 1);
        }
      }
    }
  }

  function updateHelicopterPhysics(heli, dt) {
    // Stijgen/dalen met gas/rem, vrij bewegen met de stick zodra in de lucht
    if (input.gas) heli.altitude = Math.min(1, heli.altitude + dt * 0.5);
    else if (input.brake) heli.altitude = Math.max(0, heli.altitude - dt * 0.5);
    heli.rotorSpin += dt * (6 + heli.altitude * 14);

    if (heli.altitude > 0.08) {
      const mx = input.moveX, my = input.moveY;
      const mag = Math.hypot(mx, my);
      if (mag > 0.08) {
        heli.angle = Math.atan2(my, mx);
        heli.speed = Math.min(heli.speed + 260 * dt, heli.topSpeed);
      } else {
        heli.speed *= (1 - Math.min(1, 1.5 * dt));
      }
      const nx = heli.x + Math.cos(heli.angle) * heli.speed * dt;
      const ny = heli.y + Math.sin(heli.angle) * heli.speed * dt;
      // In de lucht: geen gebouwbotsing, wel wereldgrenzen
      heli.x = nx; heli.y = ny;
      clampToWorld(heli);
    } else {
      heli.speed *= (1 - Math.min(1, 3 * dt));
      // Bijna geland, maar er staat een gebouw onder hem: niet laten zakken
      // (geen teleport — gewoon even blijven zweven tot de speler wegvliegt)
      if (collidesBuilding(heli.x, heli.y, 20) && heli.altitude < 0.15) {
        heli.altitude = 0.15;
      }
    }
  }

  function updatePlanePhysics(pl, dt) {
    const wasOnRunway = pl.altitude <= 0.02;

    // GAS/REM bedienen altijd voorwaartse snelheid — net als bij de auto's.
    if (input.gas) pl.speed = Math.min(pl.speed + 180 * dt, pl.topSpeed);
    else if (input.brake) pl.speed = Math.max(pl.speed - 200 * dt, 0);
    else pl.speed *= (1 - Math.min(1, 0.3 * dt));

    const canFly = pl.speed >= pl.minFlightSpeed;

    if (wasOnRunway) {
      // Op de grond: alleen rechtdoor over de startbaan, lichte stuurcorrectie
      pl.angle += input.moveX * 0.6 * dt * (pl.speed > 10 ? 1 : 0);
      // Zodra er genoeg snelheid is, bepaalt GAS net als bij de heli actief
      // de stijgsnelheid — dat maakt opstijgen voelbaar in plaats van
      // automatisch, en sluit aan bij hoe de helikopter werkt.
      if (canFly && input.gas) {
        pl.altitude = Math.min(1, pl.altitude + dt * 0.5);
      }
    } else {
      // In de lucht: vrij sturen. GAS = stijgen, REM = dalen — zelfde
      // bediening als de helikopter. Onder de minimumsnelheid zak je
      // vanzelf, ongeacht input (een vliegtuig kan niet blijven hangen).
      pl.angle += input.moveX * 1.1 * dt;
      if (!canFly) {
        pl.altitude = Math.max(0, pl.altitude - dt * 0.35);
      } else if (input.gas) {
        pl.altitude = Math.min(1, pl.altitude + dt * 0.5);
      } else if (input.brake) {
        pl.altitude = Math.max(0, pl.altitude - dt * 0.5);
      }
    }

    const nx = pl.x + Math.cos(pl.angle) * pl.speed * dt;
    const ny = pl.y + Math.sin(pl.angle) * pl.speed * dt;
    if (pl.altitude > 0.05) {
      pl.x = nx; pl.y = ny; // vliegend: geen gebouwbotsing
    } else {
      if (!collidesBuilding(nx, pl.y, 26)) pl.x = nx; else pl.speed *= 0.2;
      if (!collidesBuilding(pl.x, ny, 26)) pl.y = ny; else pl.speed *= 0.2;
    }
    clampToWorld(pl);
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
        flashMessage(t("pickupDelivered"));
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
        flashMessage(t("passengerIn"));
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
    drawCanalBridges();
    drawCanalTrees();
    drawRoadMarkings();
    drawBuildings();
    drawSpecialZones();
    drawShops();
    drawPickups();
    drawMissionMarker();
    drawMissionTargets();
    drawPedestrians();
    drawCyclists();
    drawCars();
    for (const t of tanks) if (t !== player.inCar) drawTank(t);
    for (const h of helicopters) if (h !== player.inCar) drawHelicopter(h);
    for (const p of planes) if (p !== player.inCar) drawPlane(p);
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
    const t = performance.now() / 1000;
    ctx.save();
    for (const s of CANAL.strips) {
      // Amsterdamse grachten: groenig-bruin water, geen felle teal
      ctx.fillStyle = "#2a3a28";
      if (s.vertical) {
        ctx.fillRect(s.x - s.w / 2, r.y0, s.w, r.y1 - r.y0);
      } else {
        ctx.fillRect(r.x0, s.y - s.h / 2, r.x1 - r.x0, s.h);
      }

      // zachte rimpel-highlights (horizontale streepjes die langzaam bewegen)
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = "#8fae7a";
      ctx.lineWidth = 1.5;
      if (s.vertical) {
        ctx.beginPath();
        for (let y = r.y0 - 40; y < r.y1 + 40; y += 26) {
          const wob = Math.sin(t * 0.6 + y * 0.02) * 6;
          ctx.moveTo(s.x - s.w / 2 + 8 + wob, y);
          ctx.lineTo(s.x + s.w / 2 - 8 + wob, y);
        }
        ctx.stroke();
      } else {
        ctx.beginPath();
        for (let x = r.x0 - 40; x < r.x1 + 40; x += 26) {
          const wob = Math.sin(t * 0.6 + x * 0.02) * 6;
          ctx.moveTo(x, s.y - s.h / 2 + 8 + wob);
          ctx.lineTo(x, s.y + s.h / 2 - 8 + wob);
        }
        ctx.stroke();
      }
      ctx.restore();

      // kade-rand (stenen walkant) in plaats van felle neon-lijn
      ctx.strokeStyle = "rgba(60,54,44,0.8)";
      ctx.lineWidth = 3;
      if (s.vertical) {
        ctx.beginPath();
        ctx.moveTo(s.x - s.w / 2, r.y0); ctx.lineTo(s.x - s.w / 2, r.y1);
        ctx.moveTo(s.x + s.w / 2, r.y0); ctx.lineTo(s.x + s.w / 2, r.y1);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(r.x0, s.y - s.h / 2); ctx.lineTo(r.x1, s.y - s.h / 2);
        ctx.moveTo(r.x0, s.y + s.h / 2); ctx.lineTo(r.x1, s.y + s.h / 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCanalBridges() {
    const r = visibleWorldRect();
    for (const br of CANAL_BRIDGES) {
      if (br.x < r.x0 - 60 || br.x > r.x1 + 60 || br.y < r.y0 - 60 || br.y > r.y1 + 60) continue;
      ctx.save();
      ctx.translate(br.x, br.y);
      if (br.vertical) ctx.rotate(Math.PI / 2);
      // brugdek — steen/asfalt kleur, iets breder dan de gracht zodat 'm overspant
      const deckLen = br.w;
      ctx.fillStyle = "#5a5248";
      ctx.fillRect(-26, -deckLen / 2, 52, deckLen);
      // leuningen aan weerszijden
      ctx.fillStyle = "#3a352e";
      ctx.fillRect(-26, -deckLen / 2, 4, deckLen);
      ctx.fillRect(22, -deckLen / 2, 4, deckLen);
      // lichte boogaanduiding in het midden (klassieke Amsterdamse brug)
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-26, 0); ctx.quadraticCurveTo(0, 8, 26, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCanalTrees() {
    const r = visibleWorldRect();
    const t = performance.now() / 1000;
    for (const tr of CANAL_TREES) {
      if (tr.x < r.x0 - 30 || tr.x > r.x1 + 30 || tr.y < r.y0 - 30 || tr.y > r.y1 + 30) continue;
      const sway = Math.sin(t * 0.8 + tr.sway) * 2;
      ctx.save();
      ctx.translate(tr.x, tr.y);
      // schaduw
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath(); ctx.ellipse(2, 10, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
      // stam
      ctx.fillStyle = "#3d2e22";
      ctx.fillRect(-2, -2, 4, 12);
      // kroon — een paar overlappende cirkels voor een vol, licht asymmetrisch silhouet
      ctx.fillStyle = "#2f5a34";
      ctx.beginPath(); ctx.arc(sway, -10, 10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sway - 6, -6, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sway + 7, -7, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(80,140,80,0.4)";
      ctx.beginPath(); ctx.arc(sway - 3, -13, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
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

  function buildingGablePath(b) {
    // Tekent het gevel-silhouet: platte kroonlijst voor brede/moderne panden,
    // een Amsterdamse trapgevel (aflopende treden naar een punt) voor smalle,
    // hoge grachtenpanden.
    const x = b.x, y = b.y, w = b.w, h = b.h;
    ctx.beginPath();
    if (!b.hasStepGable) {
      ctx.rect(x, y, w, h);
      return;
    }
    const steps = b.gableSteps;
    const gableH = Math.min(h * 0.32, 10 + steps * 7);
    const bodyTop = y + gableH;
    const stepW = w / (steps * 2 + 1);
    ctx.moveTo(x, bodyTop);
    // linkerkant trapsgewijs omhoog naar het midden
    for (let i = 0; i < steps; i++) {
      const stepY = bodyTop - (gableH * (i + 1)) / steps;
      ctx.lineTo(x + stepW * i, bodyTop - (gableH * i) / steps);
      ctx.lineTo(x + stepW * i, stepY);
      ctx.lineTo(x + stepW * (i + 1), stepY);
    }
    // punt boven in het midden
    ctx.lineTo(x + w / 2, y);
    // rechterkant symmetrisch terug naar beneden
    for (let i = steps; i > 0; i--) {
      const stepY = bodyTop - (gableH * i) / steps;
      ctx.lineTo(x + w - stepW * (i - 1), stepY);
      ctx.lineTo(x + w - stepW * (i - 1), bodyTop - (gableH * (i - 1)) / steps);
    }
    ctx.lineTo(x + w, bodyTop);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  function drawBuildings() {
    const r = visibleWorldRect();
    const night = dayNightFactor();
    for (const b of BUILDINGS) {
      if (b.x + b.w < r.x0 || b.x > r.x1 || b.y + b.h < r.y0 || b.y > r.y1) continue;

      // depth shadow — taller tiers cast a bigger offset shadow (cheap pseudo-3D)
      const shadowOff = 3 + b.heightTier * 3;
      ctx.save();
      ctx.translate(shadowOff, shadowOff);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      buildingGablePath(b);
      ctx.fill();
      ctx.restore();

      // gevel-silhouet (trapgevel of platte kroonlijst)
      ctx.save();
      buildingGablePath(b);
      ctx.clip();

      ctx.fillStyle = b.baseColor;
      ctx.fillRect(b.x, b.y, b.w, b.h);

      // voeglijnen — horizontale baksteenrijen, subtiel
      ctx.strokeStyle = b.mortarColor || "rgba(0,0,0,0.15)";
      ctx.lineWidth = 1;
      for (let my = b.y + 5; my < b.y + b.h; my += 5) {
        ctx.beginPath();
        ctx.moveTo(b.x, my);
        ctx.lineTo(b.x + b.w, my);
        ctx.stroke();
      }

      // witte gevelband zoals bij klassieke grachtenpanden (accentlijn tussen verdiepingen)
      if (b.trimAccent) {
        ctx.fillStyle = "rgba(240,235,220,0.5)";
        ctx.fillRect(b.x, b.y + b.h * 0.42, b.w, 2.5);
      }

      ctx.fillStyle = b.trimColor;
      ctx.fillRect(b.x, b.y, b.w, 3);
      ctx.fillRect(b.x, b.y, 3, b.h);
      ctx.fillRect(b.x + b.w - 3, b.y, 3, b.h);

      ctx.restore(); // einde clip

      // gevelomtrek (incl. trapgevel-vorm) met een subtiel neon-randje, zoals voorheen
      ctx.save();
      buildingGablePath(b);
      ctx.strokeStyle = b.roof === "pink" ? "rgba(255,46,142,0.4)" : "rgba(46,230,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // storey lines + windows (lit windows increase at night)
      const litChance = 0.28 + night * 0.4;
      const windowTop = b.hasStepGable ? b.y + Math.min(b.h * 0.32, 10 + b.gableSteps * 7) + 4 : b.y + 6;
      for (let s = 0; s < b.storeys; s++) {
        const rowY = windowTop + s * b.storeyH;
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

  function drawGroundPad(x, y, radius, color, label) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(20,18,30,0.6)";
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "bold 9px Courier New";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, -radius - 8);
    ctx.restore();
  }

  function drawSpecialZones() {
    const r = visibleWorldRect();

    // landingsplekjes onder elke (niet-bezette) tank/heli, zodat ze herkenbaar zijn
    for (const tk of tanks) {
      if (tk.occupied || tk === player.inCar) continue;
      if (tk.x < r.x0 - 60 || tk.x > r.x1 + 60 || tk.y < r.y0 - 60 || tk.y > r.y1 + 60) continue;
      drawGroundPad(tk.x, tk.y, 60, "#5dff7a", t("zoneLabelTank"));
    }
    for (const h of helicopters) {
      if (h.occupied || h === player.inCar) continue;
      if (h.x < r.x0 - 60 || h.x > r.x1 + 60 || h.y < r.y0 - 60 || h.y > r.y1 + 60) continue;
      drawGroundPad(h.x, h.y, 50, "#2ee6ff", t("zoneLabelHeli"));
    }

    // startbanen bij elk vliegveld
    for (const a of AIRFIELDS) {
      const halfLen = a.runwayLen / 2 + 60;
      if (a.x + halfLen < r.x0 || a.x - halfLen > r.x1 || a.y + halfLen < r.y0 || a.y - halfLen > r.y1) continue;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle);
      ctx.fillStyle = "rgba(40,36,54,0.9)";
      ctx.fillRect(-a.runwayLen / 2, -36, a.runwayLen, 72);
      ctx.strokeStyle = "rgba(255,225,77,0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([16, 10]);
      ctx.beginPath();
      ctx.moveTo(-a.runwayLen / 2, 0);
      ctx.lineTo(a.runwayLen / 2, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffe14d";
      ctx.font = "bold 11px Courier New";
      ctx.textAlign = "center";
      ctx.rotate(-a.angle);
      ctx.fillText(t("zoneLabelAirfield"), 0, -56);
      ctx.restore();
    }
  }

  function drawTank(tankV) {
    ctx.save();
    ctx.translate(tankV.x, tankV.y);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(3, 4, tankV.w / 1.8, tankV.h / 1.8, 0, 0, Math.PI * 2); ctx.fill();

    ctx.rotate(tankV.angle);
    // rupsbanden
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(-tankV.w / 2, -tankV.h / 2 - 3, tankV.w, 5);
    ctx.fillRect(-tankV.w / 2, tankV.h / 2 - 2, tankV.w, 5);
    // romp
    const grad = ctx.createLinearGradient(0, -tankV.h / 2, 0, tankV.h / 2);
    grad.addColorStop(0, "#5a6b4a");
    grad.addColorStop(1, "#3a4530");
    roundRectPath(-tankV.w / 2, -tankV.h / 2, tankV.w, tankV.h, 4);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.stroke();
    ctx.restore();

    // toren + loop (apart geroteerd op turretAngle)
    ctx.save();
    ctx.translate(tankV.x, tankV.y);
    ctx.rotate(tankV.turretAngle);
    ctx.fillStyle = "#475536";
    ctx.beginPath(); ctx.arc(0, 0, tankV.h * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2e3a24";
    ctx.fillRect(0, -3, tankV.w * 0.62, 6);
    ctx.restore();

    // health bar boven de tank
    ctx.save();
    ctx.translate(tankV.x - 20, tankV.y - tankV.h - 14);
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, 40, 4);
    ctx.fillStyle = "#5dff7a"; ctx.fillRect(0, 0, 40 * (tankV.health / tankV.maxHealth), 4);
    ctx.restore();
  }

  function drawHelicopter(heli) {
    const liftOffset = heli.altitude * 14; // schaduw loopt verder weg naarmate hoger
    ctx.save();
    ctx.translate(heli.x, heli.y);
    ctx.fillStyle = `rgba(0,0,0,${(0.35 - heli.altitude * 0.2).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(liftOffset * 0.6, liftOffset * 0.6 + 6, heli.w / 2.2, heli.w / 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const scale = 1 + heli.altitude * 0.15;
    ctx.scale(scale, scale);
    ctx.rotate(heli.angle);
    // romp
    ctx.fillStyle = "#cfd6e0";
    roundRectPath(-heli.w * 0.32, -heli.h * 0.18, heli.w * 0.6, heli.h * 0.36, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(30,34,46,0.8)";
    ctx.beginPath(); ctx.arc(heli.w * 0.18, 0, heli.h * 0.14, 0, Math.PI * 2); ctx.fill();
    // staart
    ctx.fillStyle = "#cfd6e0";
    ctx.fillRect(-heli.w * 0.5, -3, heli.w * 0.22, 6);
    // rotor (draaiend)
    ctx.save();
    ctx.rotate(heli.rotorSpin);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-heli.w * 0.55, 0); ctx.lineTo(heli.w * 0.55, 0);
    ctx.moveTo(0, -heli.w * 0.55); ctx.lineTo(0, heli.w * 0.55);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function drawPlane(pl) {
    const liftOffset = pl.altitude * 20;
    ctx.save();
    ctx.translate(pl.x, pl.y);
    ctx.fillStyle = `rgba(0,0,0,${(0.3 - pl.altitude * 0.2).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(liftOffset * 0.5, liftOffset * 0.5 + 8, pl.w / 2.4, pl.w / 4, 0, 0, Math.PI * 2);
    ctx.fill();

    const scale = 1 + pl.altitude * 0.25;
    ctx.scale(scale, scale);
    ctx.rotate(pl.angle);
    // vleugels
    ctx.fillStyle = "#e4e8ef";
    ctx.fillRect(-6, -pl.w * 0.42, 12, pl.w * 0.84);
    // romp
    ctx.fillStyle = "#f2f4f8";
    roundRectPath(-pl.h * 0.45, -8, pl.h * 0.9, 16, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.stroke();
    // staartvleugel
    ctx.fillStyle = "#e4e8ef";
    ctx.fillRect(-pl.h * 0.45, -16, 10, 10);
    ctx.fillRect(-pl.h * 0.45, 6, 10, 10);
    ctx.restore();
  }

  function drawShops() {
    const r = visibleWorldRect();
    for (const s of shops) {
      if (s.x < r.x0 || s.x > r.x1 || s.y < r.y0 || s.y > r.y1) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      const shopColors = { garage: "#2ee6ff", clothing: "#ff2e8e", weapons: "#ffe14d", dealer: "#5dff7a" };
      const shopIcons = { garage: "🔧", clothing: "👕", weapons: "🔫", dealer: "🚗" };
      const col = shopColors[s.kind];
      ctx.fillStyle = col + "2e"; // ~18% alpha hex suffix
      ctx.beginPath();
      ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px Courier New";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(shopIcons[s.kind], 0, 0);
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
      if (b.isShell) {
        ctx.shadowColor = "#ff7a3d";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#ff7a3d";
        ctx.fillRect(-7, -3, 14, 6);
      } else {
        ctx.fillStyle = b.fromPlayer ? "#ffe14d" : "#ff4d6d";
        ctx.fillRect(-4, -1.5, 8, 3);
      }
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
      const v = player.inCar;
      if (v.kind === "tank") drawTank(v);
      else if (v.kind === "helicopter") drawHelicopter(v);
      else if (v.kind === "plane") drawPlane(v);
      else drawCarShape(v, "#ffe14d");
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
    const radarShopColors = { garage: "rgba(46,230,255,0.8)", clothing: "rgba(255,46,142,0.8)", weapons: "rgba(255,225,77,0.8)", dealer: "rgba(93,255,122,0.8)" };
    for (const s of shops) {
      const [sx, sy] = toRadar(s.x, s.y);
      if (Math.hypot(sx - cx, sy - cy) < radius) {
        radarCtx.fillStyle = radarShopColors[s.kind];
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

  const langBtn = document.getElementById("langBtn");
  const langBtnTitle = document.getElementById("langBtnTitle");
  if (langBtn) langBtn.addEventListener("click", toggleLanguage);
  if (langBtnTitle) langBtnTitle.addEventListener("click", toggleLanguage);
  applyLanguageToDOM();

  resize();
  draw(); // initial paint behind title screen
  checkReturnFromStripe();
})();
