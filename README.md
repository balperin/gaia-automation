# Gaia Automation

A small Foundry VTT module (core v13 or v14, PF2e system 7.x or 8.x) for the Gaia campaign.

## Features (each has a world setting under Configure Settings > Gaia Automation)
- **Vengeful Spear**: for each kindred pair, turns the `vengeful-spear` roll option on when the kindred takes applied damage and off
  after the owner's critical Strike. It waits for that Strike's damage roll, so bonuses that apply "while Vengeful Spear is active"
  still count on the crit. Pairs are set as `Name A|Name B; Name C|Name D`.
- **Vampiric Thirst**: when damage applied from a chat card to an opposition creature came from a roll with slashing, piercing or
  bleed damage, the configured actor spends the reaction (once per round), gains a stack of Blood for the Elder Vampire, and heals
  through the normal PF2e healing pipeline (roll card, then the applied-healing card, so healing-received bonuses count). Optional
  flavor line on the card and as a speech bubble, drawn without repeats from `data/vampiric-thirst-lines.json`.
  `game.modules.get("gaia-automation").api.holdThirst()` keeps the reaction for one round.

- **I've Got a Good Feeling About This** (Vanessa's Kiss): turns the `good-feeling` roll option on when the configured actor posts a
  spell cast card and off when their turn ends (12 seconds later outside combat).
- **Song of the West**: when the configured actor posts the Song of the West action card, the owner's client rolls Acrobatics to
  Perform (or Performance if higher), applies the matching `Song of the West (Aura N)` effect and posts a tier card. The GM's client
  then applies the one-time effects to every actor with a visible token inside the glow (radius 5 x stacks + 5 ft, the same formula
  as the aura effects): dying and wounded -1 (5+), heal allies and dazzle enemies for 1 round (10+), Speed bonus for 10 rounds (15+),
  lower each ally's highest of frightened, stupefied, enfeebled, clumsy or fatigued by the stack count (20+), quickened for one round
  per stack (25+). A whispered summary lists what was done. Healing reading: 2 per stack, +2 per full 5 above 25.
  `api.songOfTheWest()` runs it by hand and spends the daily use; `api.songAreaPlan(total)` previews the area effects without changing anything.

Only one client acts on any event: the active GM if one is connected, otherwise the first active owner of the actor.

## Install
Foundry setup > Add-on Modules > Install Module > paste the manifest URL:
`https://raw.githubusercontent.com/balperin/gaia-automation/main/module.json`
Then enable it in the world. On The Forge: Bazaar > Install from manifest URL, or upload the zip through the Import Wizard.

## Limits
Both features read PF2e chat cards, so they only fire when damage is applied through a card's apply buttons, not when HP is edited by hand.
