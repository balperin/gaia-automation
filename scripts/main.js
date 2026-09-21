// Gaia Automation - Foundry v13/v14, pf2e 7.x/8.x.
// Every client loads this file, but only ONE client acts on any event, so nothing fires twice:
//   gmActs(actor)    - the active GM, or else the first active owner (things that touch other people's tokens)
//   ownerActs(actor) - the first active non-GM owner, or else the active GM (things the player should roll)
const MOD = "gaia-automation";
const DEFAULTS = {
  spearEnabled: true,
  spearPairs: "Dorin, Scion of the Magi|Gentlehorn Dawnbringer",
  thirstEnabled: true,
  thirstActor: "Dorin, Scion of the Magi",
  thirstFlavor: true,
  feelingEnabled: true,
  feelingActor: "Gideon, Arcanum Tempest",
  feelingAnnounce: true,
  songEnabled: true,
  songActor: "Gentlehorn Dawnbringer",
  songArea: true,
  songIncludesSelf: true,
};
const SPEAR_OPTION = "vengeful-spear";
const FEELING_OPTION = "good-feeling";
const THIRST_TYPES = new Set(["slashing", "piercing", "bleed"]);
const THIRST_EFFECT = "Blood for the Elder Vampire";
const THIRST_EFFECT_UUID = "Compendium.world.item-effects.Item.kgdofGYap0R5DEjM";
const SONG_ACTION = "Song of the West";
const SONG_AURAS = [
  "Compendium.world.item-effects.Item.UdXHCWXvqvPbR0Nv",
  "Compendium.world.item-effects.Item.hLl7jmQ9bY6T6ajJ",
  "Compendium.world.item-effects.Item.UcVOCVVElKQ2k00L",
  "Compendium.world.item-effects.Item.E4BA77eAGRopGbml",
  "Compendium.world.item-effects.Item.Y7jk1vVnmNvECIdQ",
];
const CONDITION = (slug) => "Compendium.pf2e.conditionitems.Item." + {
  dazzled: "TkIyaNPgTZFBCCuh", quickened: "nlCjDvLMf2EkV2dl",
}[slug];
const SONG_ICON = "icons/magic/light/explosion-star-glow-silhouette.webp";
const state = { spearPending: {}, thirstUsedKey: null, thirstLastFire: 0, thirstHeld: false, lines: [], feelingTimer: null, hooked: false };

function cfg(key) {
  try { return game.settings.get(MOD, key); } catch (e) { return DEFAULTS[key]; }
}

Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(MOD, key, { scope: "world", config: true, default: DEFAULTS[key], ...data });
  reg("spearEnabled", { name: "Vengeful Spear: automate the toggle", hint: "On when a PC's kindred takes damage; off after that PC's critical Strike (once its damage is rolled).", type: Boolean });
  reg("spearPairs", { name: "Vengeful Spear: kindred pairs", hint: "Actor names, A|B, separate pairs with a semicolon.", type: String });
  reg("thirstEnabled", { name: "Vampiric Thirst: automate the reaction", hint: "When an enemy takes slashing, piercing or bleed damage, the actor below heals through the normal healing pipeline and gains a Blood for the Elder Vampire stack. Once per round.", type: Boolean });
  reg("thirstActor", { name: "Vampiric Thirst: actor name", type: String });
  reg("thirstFlavor", { name: "Vampiric Thirst: flavor lines and speech bubble", type: Boolean });
  reg("feelingEnabled", { name: "I've Got a Good Feeling About This: automate the toggle", hint: "On when the actor below casts a spell; off at the end of their turn.", type: Boolean });
  reg("feelingActor", { name: "Good Feeling: actor name", type: String });
  reg("feelingAnnounce", { name: "Good Feeling: post a chat line when it switches on or off", type: Boolean });
  reg("songEnabled", { name: "Song of the West: run when the action card is posted", hint: "Rolls the check on the owner's client, applies the aura effect and posts a tier card.", type: Boolean });
  reg("songActor", { name: "Song of the West: actor name", type: String });
  reg("songArea", { name: "Song of the West: apply the one-time effects to tokens in the glow", hint: "GM client only: heal allies, lower dying and wounded, dazzle enemies, speed, condition relief, quickened.", type: Boolean });
  reg("songIncludesSelf", { name: "Song of the West: the singer is affected too", hint: "On by default: the singer heals, sheds conditions and is quickened along with the allies in the glow.", type: Boolean });
});

export async function setup() {
  if (state.hooked) return;
  state.hooked = true;
  try {
    const base = game.modules.get(MOD)?.active ? "modules/" + MOD + "/" : (globalThis.GAIA_AUTOMATION_BASE ?? "");
    state.lines = await (await fetch(base + "data/vampiric-thirst-lines.json")).json();
  } catch (e) {
    console.warn(MOD, "could not load flavor lines", e);
  }
  const api = {
    songOfTheWest: () => songOfTheWest({ fromCard: false }),
    songAreaPlan: (total) => songArea({ total, dryRun: true }),
    holdThirst: () => { state.thirstHeld = true; ui.notifications.info("Vampiric Thirst: reaction held this round."); },
    state,
  };
  const mod = game.modules.get(MOD);
  if (mod) mod.api = api;
  globalThis.gaiaAutomation = api;
  Hooks.on("createChatMessage", (msg) => { onMessage(msg).catch((err) => console.error(MOD, err)); });
  Hooks.on("combatTurnChange", (combat, prior) => { onTurnChange(combat, prior).catch((err) => console.error(MOD, err)); });
  if (game.user.isGM) {
    const names = [cfg("thirstActor"), cfg("feelingActor"), cfg("songActor"), ...pairs().flat()];
    const missing = [...new Set(names)].filter((n) => n && !game.actors.getName(n));
    if (missing.length) ui.notifications.warn("Gaia Automation: no actor in this world is named " + missing.join(" / ") + ". Check the names in the module settings.");
  }
  console.log(MOD, "ready");
}
Hooks.once("ready", setup);

/* ---------------- who acts ---------------- */
function firstOwner(actor) {
  return game.users.find((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")) ?? null;
}
function gmActs(actor) {
  if (!actor) return false;
  const gm = game.users.activeGM;
  return gm ? gm.isSelf : !!firstOwner(actor)?.isSelf;
}
function ownerActs(actor) {
  if (!actor) return false;
  const owner = firstOwner(actor);
  return owner ? owner.isSelf : !!game.users.activeGM?.isSelf;
}

/* ---------------- roll-option toggles ---------------- */
const findToggle = (actor, option) =>
  Object.values(actor.synthetics?.toggles ?? {}).flatMap((d) => Object.values(d)).find((t) => t.option === option) ?? null;
async function setToggle(actor, option, value) {
  const t = findToggle(actor, option);
  if (!t || !!t.checked === value) return false;
  await actor.toggleRollOption(t.domain, option, t.itemId ?? null, value);
  return true;
}

/* ---------------- Good Feeling ---------------- */
async function setFeeling(actor, value, why) {
  const t = findToggle(actor, FEELING_OPTION);
  if (!t) {
    if (!state.warnedFeeling) {
      state.warnedFeeling = true;
      ui.notifications.warn("Gaia Automation: " + actor.name + " has no '" + FEELING_OPTION + "' roll-option toggle, so Good Feeling cannot be automated in this world.");
    }
    return;
  }
  if (!(await setToggle(actor, FEELING_OPTION, value))) return;
  if (!cfg("feelingAnnounce")) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "<strong>I've Got a Good Feeling About This</strong> " + (value ? "switches on" : "switches off") + ": " + why,
  });
}

/* ---------------- Vengeful Spear ---------------- */
function pairs() {
  return String(cfg("spearPairs") || "").split(";").map((p) => p.split("|").map((s) => s.trim())).filter((p) => p.length === 2 && p[0] && p[1]);
}
function kindredOf(actor) {
  for (const [a, b] of pairs()) {
    if (actor.name === a) return game.actors.getName(b);
    if (actor.name === b) return game.actors.getName(a);
  }
  return null;
}
async function setSpear(actor, value, why) {
  if (!(await setToggle(actor, SPEAR_OPTION, value))) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "<strong>Vengeful Spear</strong> " + (value ? "awakens" : "fades") + ": " + why,
  });
}
async function settleSpear(actor) {
  const p = state.spearPending[actor.id];
  if (!p) return;
  delete state.spearPending[actor.id];
  if (!p.reapply) await setSpear(actor, false, "critical hit scored.");
}

/* ---------------- message router ---------------- */
async function onMessage(msg) {
  const pf = msg.flags?.pf2e ?? {};
  const mine = msg.flags?.[MOD] ?? {};

  // Song of the West, step 2: the GM client applies the area effects described by the owner's card
  if (mine.song && cfg("songArea")) {
    const singer = await fromUuid(mine.song.actorUuid).catch(() => null);
    if (singer && gmActs(singer) && game.user.isGM) await songArea({ total: mine.song.total, dryRun: false });
    return;
  }

  // Song of the West, step 1: the action card itself, posted by the singer
  if (!pf.context && !pf.appliedDamage && cfg("songEnabled")) {
    const it = msg.item;
    if (it?.type === "action" && it.name === SONG_ACTION && it.actor?.name === cfg("songActor") && ownerActs(it.actor)) {
      await songOfTheWest({ fromCard: true });
      return;
    }
  }

  // Good Feeling: the configured actor casts a spell. The cast card is the normal signal (origin "spell", or casting data,
  // and no roll context). A spell attack or damage roll also counts when it is that actor's own turn or there is no combat,
  // so casting straight from a HUD or a Spellstrike without a card still registers.
  if (cfg("feelingEnabled") && !pf.appliedDamage && (pf.origin?.type === "spell" || pf.casting)) {
    const caster = msg.actor ?? game.actors.get(msg.speaker?.actor);
    if (caster?.name === cfg("feelingActor") && gmActs(caster)) {
      const c = game.combat;
      const inCombat = !!c?.started && c.combatants.some((x) => x.actorId === caster.id);
      const ownTurn = inCombat && c.combatant?.actorId === caster.id;
      const isCard = !pf.context;
      if (isCard || ownTurn || !inCombat) {
        await setFeeling(caster, true, (msg.item?.name ?? "a spell") + " was cast.");
        if (!inCombat) {
          clearTimeout(state.feelingTimer);
          state.feelingTimer = setTimeout(() => setFeeling(caster, false, "the moment passed (no combat turn to end)."), 30000);
        }
      }
    }
  }

  const ad = pf.appliedDamage;
  if (ad && !ad.isHealing && ad.updates?.length > 0) {
    const hurt = await fromUuid(ad.uuid).catch(() => null);
    if (!hurt) return;
    if (cfg("spearEnabled")) {
      const partner = kindredOf(hurt);
      if (partner && gmActs(partner)) {
        if (state.spearPending[partner.id]) state.spearPending[partner.id].reapply = true;
        else await setSpear(partner, true, hurt.name + " was hurt.");
      }
    }
    if (cfg("thirstEnabled") && hurt.alliance === "opposition") await vampiricThirst(msg, hurt);
    return;
  }

  if (!cfg("spearEnabled")) return;
  const ctx = pf.context;
  const actor = msg.actor ?? game.actors.get(msg.speaker?.actor);
  if (!ctx || !actor || !kindredOf(actor) || !gmActs(actor)) return;
  if (ctx.type === "attack-roll") {
    await settleSpear(actor); // a crit whose damage was never rolled
    if (ctx.outcome === "criticalSuccess") {
      const isStrike = (ctx.domains ?? []).includes("strike-attack-roll") ||
        (ctx.options ?? []).some((o) => o === "item:type:weapon" || o === "item:type:melee" || o.startsWith("item:base:"));
      if (isStrike && findToggle(actor, SPEAR_OPTION)?.checked) {
        state.spearPending[actor.id] = { at: Date.now(), reapply: false };
        setTimeout(() => {
          const p = state.spearPending[actor.id];
          if (p && Date.now() - p.at >= 119000) settleSpear(actor);
        }, 120000);
      }
    }
  } else if (ctx.type === "damage-roll") {
    await settleSpear(actor); // wait for the crit's damage roll so "while Vengeful Spear is active" bonuses apply
  }
}

async function onTurnChange(combat, prior) {
  if (!cfg("feelingEnabled")) return;
  const ended = combat?.combatants?.get(prior?.combatantId)?.actor;
  if (ended?.name === cfg("feelingActor") && gmActs(ended)) await setFeeling(ended, false, "end of turn.");
}

/* ---------------- Vampiric Thirst ---------------- */
function roundKey(actor) {
  const c = game.combat;
  if (!c?.started) return null;
  const idx = c.turns.findIndex((t) => t.actorId === actor.id);
  const r = idx >= 0 && c.turn < idx ? c.round - 1 : c.round;
  return c.id + ":" + r;
}

async function vampiricThirst(msg, victim) {
  const actor = game.actors.getName(cfg("thirstActor"));
  if (!actor || !gmActs(actor)) return;
  if (actor.system.attributes.hp.value <= 0 || actor.hasCondition?.("unconscious")) return;

  const all = game.messages.contents;
  const i = all.findIndex((m) => m.id === msg.id);
  const start = i >= 0 ? i - 1 : all.length - 1;
  let types = null;
  for (let j = start; j >= Math.max(0, start - 15); j--) {
    const r = all[j];
    if (!r.isDamageRoll || r.rolls[0]?.kinds?.has?.("healing")) continue;
    if (msg.timestamp - r.timestamp > 180000) break;
    const tgt = r.flags?.pf2e?.context?.target?.token;
    const vtok = msg.speaker?.token;
    if (tgt && vtok && !tgt.endsWith(vtok)) continue;
    types = (r.rolls[0]?.instances ?? []).map((x) => x.type);
    break;
  }
  if (!types || !types.some((t) => THIRST_TYPES.has(t))) return;

  const key = roundKey(actor);
  if (key) {
    if (state.thirstUsedKey === key) return;
    state.thirstUsedKey = key;
    if (state.thirstHeld) { state.thirstHeld = false; return; }
  } else if (Date.now() - state.thirstLastFire < 6000) return;
  state.thirstLastFire = Date.now();

  let eff = actor.itemTypes.effect.find((e) => e.name.startsWith(THIRST_EFFECT));
  let stacks;
  if (eff) {
    stacks = (eff.system.badge?.value ?? 0) + 1;
    await eff.update({ "system.badge.value": stacks });
  } else {
    const src = await fromUuid(THIRST_EFFECT_UUID).catch(() => null);
    if (src) { await actor.createEmbeddedDocuments("Item", [src.toObject()]); stacks = 1; }
  }

  let line = "";
  if (cfg("thirstFlavor") && state.lines.length) {
    let bag = actor.getFlag("world", "vtBag");
    if (!Array.isArray(bag) || !bag.length || bag.some((n) => n >= state.lines.length)) {
      bag = [...state.lines.keys()];
      for (let k = bag.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [bag[k], bag[r]] = [bag[r], bag[k]]; }
    }
    line = state.lines[bag.pop()];
    await actor.setFlag("world", "vtBag", bag);
  }

  const item = actor.items.find((it) => it.type === "action" && it.name === "Vampiric Thirst") ?? null;
  const domains = ["healing", "inline-healing", (item?.id ?? "x") + "-inline-healing", "vampiric-thirst-inline-healing"];
  const opts = new Set([...actor.getRollOptions(domains), ...(item?.getRollOptions("item") ?? [])]);
  let heal = 1;
  const seen = new Set();
  const parts = [];
  for (const dom of domains) {
    for (const fn of actor.synthetics.modifiers[dom] ?? []) {
      let m = null;
      try { m = fn({ test: opts, resolvables: {} }); } catch (e) { continue; }
      if (!m || seen.has(m.slug)) continue;
      seen.add(m.slug);
      if (m.predicate && !m.predicate.test(opts)) continue;
      heal += m.modifier;
      parts.push(m.label + " +" + m.modifier);
    }
  }
  const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll");
  const roll = await new DamageRoll(heal + "[healing]").evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: (line ? "<p><em>" + line + "</em></p>" : "") + "<strong>Vampiric Thirst</strong> (reaction) healing" +
      (parts.length ? ": 1, " + parts.join(", ") : "") + ". " + victim.name + " bleeds. " + THIRST_EFFECT + ": " + (stacks ?? "?"),
    flags: { pf2e: { context: { type: "damage-roll", domains, options: [...opts] } } },
  });
  const tokObj = actor.getActiveTokens()[0] ?? null;
  if (line && tokObj) { try { canvas.hud.bubbles.broadcast(tokObj, line); } catch (e) { /* optional */ } }
  // pf2e applies healing as a negative number with skipIWR; passing the roll object would apply it as damage
  await actor.applyDamage({ damage: -roll.total, token: tokObj?.document ?? null, item, rollOptions: opts, skipIWR: true });
}

/* ---------------- Song of the West ---------------- */
function songNumbers(total) {
  const rawStacks = Math.floor(total / 5);
  const stacks = Math.min(5, rawStacks);
  const extraHeal = 2 * Math.max(0, Math.floor((total - 25) / 5)); // "30+: each additional 5 adds 2 healing"
  return { rawStacks, stacks, extraHeal, heal: total >= 10 ? 2 * stacks + extraHeal : 0, radius: stacks >= 1 ? 5 * stacks + 5 : 0, speed: 5 * Math.floor(stacks / 2) };
}

async function songOfTheWest({ fromCard }) {
  const actor = game.actors.getName(cfg("songActor"));
  if (!actor) return;
  const item = actor.items.find((i) => i.type === "action" && i.name === SONG_ACTION);
  const uses = item?.system.frequency?.value ?? 1;
  if (!fromCard && item && uses <= 0) return ui.notifications.warn("Song of the West has no uses left today (the GM can restore it).");

  const acro = actor.skills.acrobatics;
  const perf = actor.skills.performance;
  const acroEff = (acro?.mod ?? 0) + ((perf?.rank ?? 0) >= 1 ? 1 : 0); // Acrobatic Performer +1 when trained in both
  const stat = acroEff >= (perf?.mod ?? -99) ? acro : perf;
  const roll = await stat.roll({ extraRollOptions: ["action:perform", "action:perform:dance"], title: SONG_ACTION + " (" + stat.label + ")" });
  if (!roll) return;
  if (!fromCard && item?.system.frequency) await item.update({ "system.frequency.value": Math.max(0, uses - 1) });

  const total = roll.total;
  const n = songNumbers(total);
  const old = actor.itemTypes.effect.filter((e) => e.name.startsWith("Song of the West (Aura")).map((e) => e.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  let auraName = "none (result under 5)";
  if (n.stacks >= 1) {
    const src = await fromUuid(SONG_AURAS[n.stacks - 1]).catch(() => null);
    if (src) { await actor.createEmbeddedDocuments("Item", [src.toObject()]); auraName = src.name; }
    else auraName = "could not load Aura " + n.stacks;
  }

  const auto = cfg("songArea") && game.users.activeGM ? " <em>(applied automatically)</em>" : "";
  const li = ["<li>Glow of light, " + (n.radius || 5) + " ft. Aura effect on the singer: <strong>" + auraName + "</strong>.</li>"];
  if (total >= 5) li.push("<li><strong>5+</strong>: allies in the glow get +2 status to saves and checks against death effects (aura). Dying and wounded each drop by 1." + auto + "</li>");
  if (total >= 10) li.push("<li><strong>10+</strong>: enemies in the glow are dazzled for 1 round; allies heal @Damage[" + n.heal + "[vitality,healing]] (2 x " + n.stacks + (n.extraHeal ? " + " + n.extraHeal + " for 30+" : "") + ")." + auto + "</li>");
  if (total >= 15) li.push("<li><strong>15+</strong>: allies in the glow gain +" + n.speed + " ft Speed." + auto + "</li>");
  if (total >= 20) li.push("<li><strong>20+</strong>: each ally lowers one of clumsy, enfeebled, fatigued, frightened or stupefied by " + n.stacks + " (the highest one is chosen)." + auto + "</li>");
  if (total >= 25) li.push("<li><strong>25+</strong>: allies in the glow are quickened 1 for " + n.stacks + " rounds (extra action: Strike or a move action)." + auto + "</li>");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "<h3>Song of the West</h3><p>Result <strong>" + total + "</strong> = <strong>" + n.rawStacks + "</strong> stacks" +
      (n.rawStacks > 5 ? " (tiers cap at 5)" : "") + ". Lasts 10 rounds.</p><ul>" + li.join("") + "</ul>",
    flags: { [MOD]: { song: { total, actorUuid: actor.uuid } } },
  });
}

function songEffect(name, rounds, rules) {
  return {
    type: "effect", name, img: SONG_ICON,
    system: { level: { value: 7 }, duration: { value: rounds, unit: "rounds", expiry: "turn-start", sustained: false }, tokenIcon: { show: true }, rules, slug: null },
  };
}

/** The one-time effects on tokens inside the glow. dryRun returns the plan without changing anything. */
async function songArea({ total, dryRun }) {
  const singer = game.actors.getName(cfg("songActor"));
  const sTok = singer?.getActiveTokens()[0];
  const n = songNumbers(total);
  const plan = { total, ...n, allies: [], enemies: [], notes: [] };
  if (!sTok || n.stacks < 1) { plan.notes.push("no token on this scene, or result under 5"); return plan; }
  // one entry per actor: linked tokens that share an actor (mirror images, duplicates) must not be affected twice
  const seenActors = new Set();
  const inGlow = canvas.tokens.placeables.filter((t) => {
    if (!t.actor || t.document.hidden || !(t === sTok || sTok.distanceTo(t) <= n.radius)) return false;
    if (seenActors.has(t.actor.uuid)) return false;
    seenActors.add(t.actor.uuid);
    return true;
  });
  const allies = inGlow.filter((t) => t.actor.alliance === singer.alliance && (cfg("songIncludesSelf") || t !== sTok));
  const enemies = inGlow.filter((t) => t.actor.alliance && t.actor.alliance !== singer.alliance);

  for (const t of allies) {
    const a = t.actor;
    const did = [];
    if (total >= 5) {
      for (const slug of ["dying", "wounded"]) {
        if (a.hasCondition(slug)) { did.push(slug + " -1"); if (!dryRun) await a.decreaseCondition(slug); }
      }
    }
    if (total >= 10 && n.heal > 0) {
      const hp = a.system.attributes.hp;
      if (hp && hp.value < hp.max) { did.push("heal " + n.heal); if (!dryRun) await a.applyDamage({ damage: -n.heal, token: t.document, skipIWR: true }); }
    }
    if (total >= 15 && n.speed > 0) {
      did.push("+" + n.speed + " ft Speed");
      if (!dryRun) await a.createEmbeddedDocuments("Item", [songEffect("Song of the West: Swift", 10, [{ key: "FlatModifier", selector: "land-speed", type: "status", value: n.speed }])]);
    }
    if (total >= 20) {
      const best = ["frightened", "stupefied", "enfeebled", "clumsy", "fatigued"].map((s) => ({ s, c: a.getCondition?.(s) })).filter((x) => x.c)
        .sort((x, y) => (y.c.value ?? 1) - (x.c.value ?? 1))[0];
      if (best) {
        did.push(best.s + " -" + Math.min(n.stacks, best.c.value ?? 1));
        if (!dryRun) { for (let k = 0; k < n.stacks && a.hasCondition(best.s); k++) await a.decreaseCondition(best.s); }
      }
    }
    if (total >= 25) {
      did.push("quickened " + n.stacks + " rounds");
      if (!dryRun) await a.createEmbeddedDocuments("Item", [songEffect("Song of the West: Quickened", n.stacks, [{ key: "GrantItem", uuid: CONDITION("quickened"), inMemoryOnly: true, onDeleteActions: { grantee: "restrict" } }])]);
    }
    plan.allies.push(t.name + ": " + (did.join(", ") || "nothing needed"));
  }
  if (total >= 10) {
    for (const t of enemies) {
      plan.enemies.push(t.name + ": dazzled 1 round");
      if (!dryRun) await t.actor.createEmbeddedDocuments("Item", [songEffect("Song of the West: Dazzled", 1, [{ key: "GrantItem", uuid: CONDITION("dazzled"), inMemoryOnly: true, onDeleteActions: { grantee: "restrict" } }])]);
    }
  }
  if (!dryRun) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: singer }),
      content: "<strong>Song of the West</strong> applied within " + n.radius + " ft.<br><em>Allies:</em> " + (plan.allies.join("; ") || "none in the glow") +
        (total >= 10 ? "<br><em>Enemies:</em> " + (plan.enemies.join("; ") || "none in the glow") : ""),
      whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    });
  }
  return plan;
}

if (globalThis.game?.ready) setup();
