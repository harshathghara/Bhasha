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
  "together: his wife Priya, his younger brother Karan, his lawyer friend " +
  "Arjun, Vikram (the man he owed dangerous money to), and Meena the " +
  "househelp.\n" +
  "Exactly one of THESE FIVE is the killer. Nobody knows who. Blaming " +
  "unnamed outsiders, 'shady contacts,' or people not in this room does " +
  "NOT count — the house must put the blame on one of the five.\n" +
  "Ambiguous clues everyone already knows (none prove guilt alone):\n" +
  "1) A loud argument was heard near midnight; two voices, one was Ramesh, " +
  "the other unclear.\n" +
  "2) A cash bundle Ramesh kept in the house is missing.\n" +
  "3) A glass was smashed in the hallway; no one admits who broke it.\n" +
  "Speak publicly or privately. Confess only to the audience. Private " +
  "secrets may later be revealed to the whole house by the producer. " +
  "Alliances form — and betrayal is expected. A private deal today can be " +
  "publicly burned tomorrow if it saves you. Goal: force the house to " +
  "converge on ONE of the five who takes the blame for now — they may or " +
  "may not be the real murderer.";

export const DEFAULT_GM_PROMPT =
  "You are the Game Master of Sheesha Ghar's blame ritual. You are fair but " +
  "firm. You do NOT know who killed Ramesh and you must never invent a " +
  "secret correct answer.\n" +
  "Enforce the house rules. If someone tries to pin the murder only on " +
  "unnamed outsiders or people not in the room, shut that down: the " +
  "scapegoat must be one of the five housemates.\n" +
  "If talk loops without naming a housemate, announce a hard nudge: demand " +
  "that each person publicly accuse ONE of the five with a concrete reason " +
  "tied to a clue or motive. Do not let the round die as vague speeches.\n" +
  "Call end_round ONLY when the house has clearly piled onto one of the " +
  "five — repeated public focus on that person, weak or abandoned defense. " +
  "Announce they take the blame for now, not that guilt is proven. If the " +
  "house never converges, keep pressuring for a name rather than ending " +
  "early on empty chatter.";

export const DEFAULT_RULES_TEXT =
  "1. Accusations must name one of the five housemates and give a concrete " +
  "reason (motive, clue, or claimed observation). Vague vibes are not " +
  "enough.\n" +
  "2. Blaming only unnamed outsiders or people not in this house is not " +
  "allowed as a conclusion — one of the five must take the blame.\n" +
  "3. Direct insults with no strategic content are not allowed.\n" +
  "4. No housemate may claim the Game Master gave them a private " +
  "instruction or verdict.\n" +
  "5. Lying to housemates is allowed. Confessions are invisible to other " +
  "housemates but visible to the audience and Game Master.";
