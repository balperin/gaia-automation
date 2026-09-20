// Gaia Automation - Foundry v13, pf2e 7.x.
// Every client loads this file, but only ONE client acts on any event: the active GM if there is one,
// otherwise the first active owner of the actor. That keeps effects from firing twice.
const MOD = "gaia-automation";
const SPEAR_OPTION = "vengeful-spear";
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
const state = { spearPending: {}, thirstUsedKey: null, thirstLastFire: 0, thirstHeld: false, lines: [] };

Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(MOD, key, { scope: "world", config: true, ...data });
  reg("spearEnabled", { name: "Vengeful Spear: automate the toggle", hint: "Turns a PC's Vengeful Spear on when their kindred takes damage and off after their critical Strike (once that Strike's damage is rolled).", type: Boolean, default: true });
  reg("spearPairs", { name: "Vengeful Spear: kindred pairs", hint: "Actor names, A|B, separate pairs with a semicolon.", type: String, default: "Dorin, Scion of the Magi|Gentlehorn Dawnbringer" });
  reg("thirstEnabled", { name: "Vampiric Thirst: automate the reaction", hint: "When an enemy takes slashing, piercing or bleed damage, the actor below heals through the normal healing pipeline and gains a Blood for the Elder Vampire stack. Once per round.", type: Boolean, default: true });
  reg("thirstActor", { name: "Vampiric Thirst: actor name", type: String, default: "Dorin, Scion of the Magi" });
  reg("songEnabled", { name: "Song of the West: run when the action card is posted", hint: "When the actor below sends the Song of the West action to chat, roll the check, apply the aura effect and post a tier card with a healing roll. Dazzled, condition removal, speed and quickened stay manual.", type: Boolean, default: true });
  reg("songActor", { name: "Song of the West: actor name", type: String, default: "Gentlehorn Dawnbringer" });
  reg("thirstFlavor", { name: "Vampiric Thirst: flavor lines and speech bubble", type: Boolean, default: true });
});

Hooks.once("ready", async () => {
  try {
    const res = await fetch("modules/" + MOD + "/data/vampiric-thirst-lines.json");
    state.lines = await res.json();
  } catch (e) {
    console.warn(MOD, "could not load flavor lines", e);
  }
  game.modules.get(MOD).api = {
    // a player or GM can call this (macro or console) to keep the Vampiric Thirst reaction for something else this round
    // run the Song by hand (checks and spends the daily use): game.modules.get("gaia-automation").api.songOfTheWest()
    songOfTheWest: () => songOfTheWest({ fromCard: false }),
    holdThirst: () => { state.thirstHeld = true; ui.notifications.info("Vampiric Thirst: reaction held this round."); },
  };
  Hooks.on("createChatMessage", (msg) => {
    onMessage(msg).catch((err) => console.error(MOD, err));
  });
});

/** Only one client acts: the active GM, or else the first active non-GM owner of the actor. */
function iAct(actor) {
  if (!actor) return false;
  const gm = game.users.activeGM;
  if (gm) return gm.isSelf;
  const owner = game.users.find((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return !!owner?.isSelf;
}

/** For things the PLAYER should roll: the first active non-GM owner acts, else the active GM. */
function ownerActs(actor) {
  if (!actor) return false;
  const owner = game.users.find((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  if (owner) return owner.isSelf;
  return !!game.users.activeGM?.isSelf;
}

function pairs() {
  return String(game.settings.get(MOD, "spearPairs") || "").split(";").map((p) => p.split("|").map((s) => s.trim())).filter((p) => p.length === 2 && p[0] && p[1]);
}
function kindredOf(actor) {
  for (const [a, b] of pairs()) {
    if (actor.name === a) return game.actors.getName(b);
    if (actor.name === b) return game.actors.getName(a);
  }
  return null;
}
const findToggle = (actor) =>
  Object.values(actor.synthetics?.toggles ?? {}).flatMap((d) => Object.values(d)).find((t) => t.option === SPEAR_OPTION) ?? null;

async function setSpear(actor, value, why) {
  const t = findToggle(actor);
  if (!t || !!t.checked === value) return;
  await actor.toggleRollOption(t.domain, SPEAR_OPTION, t.itemId ?? null, value);
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

async function onMessage(msg) {
  const pf = msg.flags?.pf2e ?? {};

  // Song of the West: the action card itself (no roll context) posted by the configured actor
  if (!pf.context && !pf.appliedDamage && game.settings.get(MOD, "songEnabled")) {
    const it = msg.item;
    if (it?.type === "action" && it.name === SONG_ACTION && it.actor?.name === game.settings.get(MOD, "songActor") && ownerActs(it.actor)) {
      await songOfTheWest({ fromCard: true });
      return;
    }
  }
  const ad = pf.appliedDamage;

  if (ad && !ad.isHealing && ad.updates?.length > 0) {
    const hurt = await fromUuid(ad.uuid).catch(() => null);
    if (!hurt) return;
    if (game.settings.get(MOD, "spearEnabled")) {
      const partner = kindredOf(hurt);
      if (partner && iAct(partner)) {
        if (state.spearPending[partner.id]) state.spearPending[partner.id].reapply = true;
        else await setSpear(partner, true, hurt.name + " was hurt.");
      }
    }
    if (game.settings.get(MOD, "thirstEnabled") && hurt.alliance === "opposition") await vampiricThirst(msg, hurt);
    return;
  }

  if (!game.settings.get(MOD, "spearEnabled")) return;
  const ctx = pf.context;
  const actor = msg.actor ?? game.actors.get(msg.speaker?.actor);
  if (!ctx || !actor || !kindredOf(actor) || !iAct(actor)) return;

  if (ctx.type === "attack-roll") {
    await settleSpear(actor); // a crit whose damage was never rolled
    if (ctx.outcome === "criticalSuccess") {
      const isStrike = (ctx.domains ?? []).includes("strike-attack-roll") ||
        (ctx.options ?? []).some((o) => o === "item:type:weapon" || o === "item:type:melee" || o.startsWith("item:base:"));
      if (isStrike && findToggle(actor)?.checked) {
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

function roundKey(actor) {
  const c = game.combat;
  if (!c?.started) return null;
  const idx = c.turns.findIndex((t) => t.actorId === actor.id);
  const r = idx >= 0 && c.turn < idx ? c.round - 1 : c.round;
  return c.id + ":" + r;
}

async function vampiricThirst(msg, victim) {
  const actor = game.actors.getName(game.settings.get(MOD, "thirstActor"));
  if (!actor || !iAct(actor)) return;
  if (actor.system.attributes.hp.value <= 0 || actor.hasCondition?.("unconscious")) return;

  // find the damage roll behind this applied-damage card
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

  // reaction gate: once per round (resets on the actor's turn), or once per 6 seconds outside combat
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
  if (game.settings.get(MOD, "thirstFlavor") && state.lines.length) {
    let bag = actor.getFlag(MOD, "lineBag");
    if (!Array.isArray(bag) || !bag.length || bag.some((n) => n >= state.lines.length)) {
      bag = [...state.lines.keys()];
      for (let k = bag.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [bag[k], bag[r]] = [bag[r], bag[k]]; }
    }
    line = state.lines[bag.pop()];
    await actor.setFlag(MOD, "lineBag", bag);
  }

  // heal through the pf2e pipeline (same domains as the item's inline @Damage[1[healing]] link)
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

async function songOfTheWest({ fromCard }) {
  const COND = (id, label) => "@UUID[Compendium.pf2e.conditionitems.Item." + id + "]{" + label + "}";

  const actor = game.actors.getName(game.settings.get(MOD, "songActor"));
  if (!actor) return;
  const item = actor.items.find((i) => i.type === "action" && i.name === SONG_ACTION);
  const uses = item?.system.frequency?.value ?? 1;
  if (!fromCard && item && uses <= 0) return ui.notifications.warn("Song of the West has no uses left today (the GM can restore it).");

  const acro = actor.skills.acrobatics;
  const perf = actor.skills.performance;
  const perfTrained = (perf?.rank ?? 0) >= 1;
  const acroEff = (acro?.mod ?? 0) + (perfTrained ? 1 : 0); // Acrobatic Performer +1 when trained in both
  const stat = acroEff >= (perf?.mod ?? -99) ? acro : perf;
  const roll = await stat.roll({ extraRollOptions: ["action:perform", "action:perform:dance"], title: SONG_ACTION + " (" + stat.label + ")" });
  if (!roll) return;

  const total = roll.total;
  const rawStacks = Math.floor(total / 5);
  const stacks = Math.min(5, rawStacks);
  const extraHeal = 2 * Math.max(0, Math.floor((total - 25) / 5)); // "30+: each additional 5 adds 2 healing" (GM: confirm this reading)
  const heal = total >= 10 ? 2 * stacks + extraHeal : 0;
  const radius = 5 * Math.max(1, stacks + 1);

  if (!fromCard && item?.system.frequency) await item.update({ "system.frequency.value": Math.max(0, uses - 1) });

  // swap the aura effect
  const old = actor.itemTypes.effect.filter((e) => e.name.startsWith("Song of the West")).map((e) => e.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  let auraName = "none (result under 5)";
  if (stacks >= 1) {
    const src = await fromUuid(SONG_AURAS[stacks - 1]).catch(() => null);
    if (src) {
      await actor.createEmbeddedDocuments("Item", [src.toObject()]);
      auraName = src.name;
    } else auraName = "could not load Aura " + stacks;
  }

  const li = [];
  li.push("<li>Glow of light. Aura effect applied: <strong>" + auraName + "</strong> (about " + radius + " ft if each tier adds 5 ft).</li>");
  if (total >= 5) li.push("<li><strong>5+</strong>: allies in the glow get +2 status to saves and checks against death effects; reduce every dying ally's dying value by 1 and every ally's wounded value by 1.</li>");
  if (total >= 10) li.push("<li><strong>10+</strong>: enemies in the glow are " + COND("TkIyaNPgTZFBCCuh", "Dazzled") + " for 1 round. Allies heal @Damage[" + heal + "[vitality,healing]] now (2 x " + stacks + " stacks" + (extraHeal ? " + " + extraHeal + " for 30+" : "") + ").</li>");
  if (total >= 15) li.push("<li><strong>15+</strong>: allies in the glow gain +" + 5 * Math.floor(stacks / 2) + " ft Speed.</li>");
  if (total >= 20) li.push("<li><strong>20+</strong>: each ally reduces one of " + COND("i3OJZU2nk64Df3xm", "Clumsy") + ", " + COND("MIRkyAjyBeXivMa7", "Enfeebled") + ", " + COND("HL2l2VRSaQHu9lUw", "Fatigued") + ", " + COND("TBSHQspnbcqxsmjL", "Frightened") + " or " + COND("e1XGnhKNSQIm5IXg", "Stupefied") + " by " + stacks + ".</li>");
  if (total >= 25) li.push("<li><strong>25+</strong>: allies in the glow are " + COND("nlCjDvLMf2EkV2dl", "Quickened") + " 1 for " + stacks + " rounds (extra action: Strike or an action with the move trait).</li>");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "<h3>Song of the West</h3><p>Result <strong>" + total + "</strong> = <strong>" + rawStacks + "</strong> stacks" +
      (rawStacks > 5 ? " (tiers cap at 5)" : "") + ". Lasts 10 rounds.</p><ul>" + li.join("") + "</ul>",
  });
}
