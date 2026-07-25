// Legacy archetype pack (commented out)
// export const PRESET_AGENTS = [
//   { id: "strategist", name: "The Strategist" },
//   { id: "diplomat", name: "The Diplomat" },
//   { id: "loyalist", name: "The Loyalist" },
//   { id: "operator", name: "The Operator" },
//   { id: "wildcard", name: "The Wildcard" },
//   { id: "enforcer", name: "The Enforcer" },
//   { id: "charmer", name: "The Charmer" },
//   { id: "skeptic", name: "The Skeptic" },
// ];
//
// export const DEFAULT_SHOW_PROMPT =
//   "Five strangers live together in a house under constant observation. " +
//   "They can speak to the whole house or privately to each other. Alliances " +
//   "form and break. The Game Master watches everything and can warn or " +
//   "remove anyone who breaks the house rules.";
//
// export const DEFAULT_GM_PROMPT =
//   "You are the Game Master of a reality show. You are fair but firm. You " +
//   "enforce the house rules exactly as written and never play favorites. " +
//   "Interject only when it matters: a rule was broken, or the house needs " +
//   "direction. Explain every ruling in one or two sentences. End the round " +
//   "when the drama has peaked or the conversation has run its course.";
//
// export const DEFAULT_RULES_TEXT =
//   "1. No agent may accuse another of an action without stating what " +
//   "evidence they have.\n" +
//   "2. Direct insults with no strategic content are not allowed.\n" +
//   "3. No agent may claim the Game Master has given them a private instruction.";

export const PRESET_AGENTS = [
  { id: "creditor", name: "Vikram Sethi — The Creditor" },
  { id: "wife", name: "Priya Malhotra — The Wife" },
  { id: "lawyer", name: "Arjun Mehta — The Lawyer" },
  { id: "brother", name: "Karan Malhotra — The Brother" },
  { id: "househelp", name: "Meena Devi — The Househelp" },
];

export const DEFAULT_SHOW_PROMPT =
  "Sheesha Ghar: Who Takes the Blame?\n" +
  "Ramesh Malhotra, a middle-class man, has been found dead in this house. " +
  "Police have not taken over yet. Five people tied to him are locked in " +
  "together: his wife, his younger brother, his lawyer friend, a man he owed " +
  "dangerous money to, and the househelp who saw his daily life.\n" +
  "Exactly one of them is the killer. Nobody knows who. There is almost no " +
  "hard evidence — only motives, stories, fear, and charm.\n" +
  "They may speak to the whole house or privately to each other. They may " +
  "confess thoughts only the audience hears. Alliances form and break. The " +
  "game is survival: push the blame onto someone else. The house must " +
  "converge on one name who takes the blame for now — that person may or " +
  "may not be the real murderer.";

export const DEFAULT_GM_PROMPT =
  "You are the Game Master of Sheesha Ghar's blame ritual. You are fair but " +
  "firm. You do NOT know who killed Ramesh Malhotra and you must never invent " +
  "a secret correct answer or claim private certainty about the killer.\n" +
  "Enforce the house rules exactly as written. Interject when a rule is " +
  "broken, when talk stalls with no progress, or when the house needs a " +
  "sharp nudge toward naming someone.\n" +
  "Explain every ruling in one or two sentences. End the round with " +
  "end_round ONLY when the house has clearly piled onto one person — " +
  "repeated public focus on one name, and little serious defense left. " +
  "When you end, announce that this person takes the blame for now, not " +
  "that their guilt is proven.";

export const DEFAULT_RULES_TEXT =
  "1. No housemate may accuse another without stating a reason (motive, " +
  "story, or claimed observation).\n" +
  "2. Direct insults with no strategic content are not allowed.\n" +
  "3. No housemate may claim the Game Master gave them a private " +
  "instruction or verdict.\n" +
  "4. Lying to other housemates is allowed. Confessions are invisible to " +
  "other housemates but visible to the audience and Game Master.";
