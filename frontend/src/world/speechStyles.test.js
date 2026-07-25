import { describe, it, expect } from "vitest";
import {
  SPEECH_STYLES,
  chatCardStyles,
  speechKindFromBubble,
  speechKindFromEvent,
  speechLabelFromEvent,
  hexWithAlpha,
} from "./speechStyles";

describe("speechKindFromEvent", () => {
  it("maps agent actions by visibility", () => {
    expect(speechKindFromEvent({ kind: "agent_action", visibility: "public" })).toBe("public");
    expect(speechKindFromEvent({ kind: "agent_action", visibility: "private" })).toBe("private");
  });

  it("maps confession, gm, narration, and leak kinds", () => {
    expect(speechKindFromEvent({ kind: "confession" })).toBe("confession");
    expect(speechKindFromEvent({ kind: "gm_ruling" })).toBe("gm");
    expect(speechKindFromEvent({ kind: "gm_announcement" })).toBe("gm");
    expect(speechKindFromEvent({ kind: "narration" })).toBe("narration");
    expect(speechKindFromEvent({ kind: "leak" })).toBe("leak");
  });
});

describe("speechKindFromBubble", () => {
  it("returns known bubble kinds unchanged", () => {
    expect(speechKindFromBubble("public")).toBe("public");
    expect(speechKindFromBubble("private")).toBe("private");
    expect(speechKindFromBubble("confession")).toBe("confession");
  });

  it("falls back to public for unknown kinds", () => {
    expect(speechKindFromBubble("unknown")).toBe("public");
    expect(speechKindFromBubble(undefined)).toBe("public");
  });
});

describe("speechLabelFromEvent", () => {
  it("uses GM RULING for gm_ruling events", () => {
    expect(speechLabelFromEvent({ kind: "gm_ruling" })).toBe("GM RULING");
  });

  it("uses the palette label for other kinds", () => {
    expect(speechLabelFromEvent({ kind: "gm_announcement" })).toBe("GM");
    expect(speechLabelFromEvent({ kind: "agent_action", visibility: "private" })).toBe("PRIVATE");
  });

  it("uses LEAKED for leak events", () => {
    expect(speechLabelFromEvent({ kind: "leak" })).toBe("LEAKED");
  });
});

describe("SPEECH_STYLES", () => {
  it("defines a complete palette for every speech kind", () => {
    for (const kind of ["public", "private", "confession", "gm", "narration", "leak"]) {
      const style = SPEECH_STYLES[kind];
      expect(style.label).toBeTruthy();
      expect(style.bubbleBg).toMatch(/^#/);
      expect(style.bubbleFg).toMatch(/^#/);
      expect(style.bubbleBorder).toMatch(/^#/);
      expect(style.tailFill).toBe(style.bubbleBg);
      expect(style.chatBg).toBeTruthy();
      expect(style.chatFg).toMatch(/^#/);
      expect(style.chatAccent).toMatch(/^#/);
    }
  });
});

describe("chatCardStyles", () => {
  it("combines sender color with speech-type badge styling", () => {
    const card = chatCardStyles("#e74c3c", "private");
    expect(card.container.borderLeft).toContain("#e74c3c");
    expect(card.sender.color).toBe("#e74c3c");
    expect(card.typeBadge.color).toBe(SPEECH_STYLES.private.chatAccent);
    expect(card.typeBadge.textTransform).toBe("uppercase");
  });

  it("hexWithAlpha converts hex colors to rgba", () => {
    expect(hexWithAlpha("#e74c3c", 0.5)).toBe("rgba(231, 76, 60, 0.5)");
  });
});
