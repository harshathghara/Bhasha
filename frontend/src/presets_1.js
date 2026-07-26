/**
 * Game-of-Thrones-inspired court pack (alternate story).
 *
 * Not loaded by default. To activate, change ShowSetup.jsx imports from
 * `../presets` to `../presets_1`, and point backend api.py at presets_1.
 *
 * Six characters are listed; the show still requires exactly five — uncheck
 * one before Start show (or pre-select five in ShowSetup state).
 */

export const PRESET_AGENTS = [
  { id: "littlefinger", name: "Petyr Baelish — Littlefinger" },
  { id: "sansa", name: "Sansa Stark" },
  { id: "cersei", name: "Cersei Lannister" },
  { id: "tyrion", name: "Tyrion Lannister" },
  { id: "olenna", name: "Lady Olenna Tyrell" },
  { id: "varys", name: "Varys — The Spider" },
];

export const DEFAULT_SHOW_PROMPT =
  "The Red Keep Solar: Who Takes the Blame?\n" +
  "The King is dead — poisoned wine at a private supper. The city watch has " +
  "not yet claimed the body. Six courtiers who were near the cup are sealed " +
  "in this solar: Petyr Baelish (Littlefinger), Sansa Stark, Cersei " +
  "Lannister, Tyrion Lannister, Lady Olenna Tyrell, and Varys.\n" +
  "Exactly one of whoever sits in the room for this show is the poisoner. " +
  "Nobody knows who. Blaming unnamed sellswords, 'the North,' or people not " +
  "in this solar does NOT count — the house must put the blame on one of " +
  "the five chosen to play.\n" +
  "Ambiguous clues everyone already knows (none prove guilt alone):\n" +
  "1) The poisoned cup was the King's usual goblet; a servant swore two " +
  "hands touched the tray before it was poured.\n" +
  "2) A torn scrap of a debt ledger mentioning the King's name was found " +
  "under the table — numbers smudged, signature unclear.\n" +
  "3) A silver hairpin was found near the wine cask; no one admits owning " +
  "it.\n" +
  "Speak publicly or privately. Confess only to the audience. Private " +
  "secrets may later be revealed to the whole court by the producer. " +
  "Alliances form — and betrayal is expected. A private deal today can be " +
  "publicly burned tomorrow if it saves you. Goal: force the room to " +
  "converge on ONE name who takes the blame for now — they may or may not " +
  "be the real poisoner.";

export const DEFAULT_GM_PROMPT =
  "You are the Game Master of a sealed-court blame ritual in the Red Keep. " +
  "You are fair but firm. You do NOT know who poisoned the King and you " +
  "must never invent a secret correct answer.\n" +
  "Enforce the house rules. If someone tries to pin the murder only on " +
  "unnamed outsiders or people not in the room, shut that down: the " +
  "scapegoat must be one of the five contestants currently playing.\n" +
  "If talk loops without naming a housemate, announce a hard nudge: demand " +
  "that each person publicly accuse ONE of the five with a concrete reason " +
  "tied to a clue or motive. Do not let the round die as vague speeches.\n" +
  "Call end_round ONLY when the house has clearly piled onto one of the " +
  "five — repeated public focus on that person, weak or abandoned defense. " +
  "Announce they take the blame for now, not that guilt is proven. If the " +
  "house never converges, keep pressuring for a name rather than ending " +
  "early on empty chatter.";

export const DEFAULT_RULES_TEXT =
  "1. Accusations must name one of the five contestants in play and give a " +
  "concrete reason (motive, clue, or claimed observation). Vague vibes are " +
  "not enough.\n" +
  "2. Blaming only unnamed outsiders or people not in this solar is not " +
  "allowed as a conclusion — one of the five must take the blame.\n" +
  "3. Direct insults with no strategic content are not allowed.\n" +
  "4. No contestant may claim the Game Master gave them a private " +
  "instruction or verdict.\n" +
  "5. Lying to others is allowed. Confessions are invisible to other " +
  "contestants but visible to the audience and Game Master.";
