# Gaia Automation

A small Foundry VTT module (core v13, PF2e system 7.x) for the Gaia campaign.

## Features (each has a world setting under Configure Settings > Gaia Automation)
- **Vengeful Spear**: for each kindred pair, turns the `vengeful-spear` roll option on when the kindred takes applied damage and off
  after the owner's critical Strike. It waits for that Strike's damage roll, so bonuses that apply "while Vengeful Spear is active"
  still count on the crit. Pairs are set as `Name A|Name B; Name C|Name D`.
- **Vampiric Thirst**: when damage applied from a chat card to an opposition creature came from a roll with slashing, piercing or
  bleed damage, the configured actor spends the reaction (once per round), gains a stack of Blood for the Elder Vampire, and heals
  through the normal PF2e healing pipeline (roll card, then the applied-healing card, so healing-received bonuses count). Optional
  flavor line on the card and as a speech bubble, drawn without repeats from `data/vampiric-thirst-lines.json`.
  `game.modules.get("gaia-automation").api.holdThirst()` keeps the reaction for one round.

Only one client acts on any event: the active GM if one is connected, otherwise the first active owner of the actor.

## Install
Foundry setup > Add-on Modules > Install Module > paste the manifest URL:
`https://github.com/balperin/gaia-automation/releases/latest/download/module.json`
Then enable it in the world. On The Forge: Bazaar > Install from manifest URL, or upload the zip through the Import Wizard.

## Limits
Both features read PF2e chat cards, so they only fire when damage is applied through a card's apply buttons, not when HP is edited by hand.
