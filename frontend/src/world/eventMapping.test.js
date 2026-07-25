import { describe, it, expect } from "vitest";
import { mapEvent } from "./eventMapping";

function baseEvent(overrides = {}) {
  return {
    seq: 5, round: 1, sender_id: "vikram", text: "hello", kind: "agent_action",
    visibility: "public", recipients: [], released: false, timestamp: 0, ...overrides,
  };
}

describe("mapEvent", () => {
  it("maps a public agent action", () => {
    expect(mapEvent(baseEvent())).toEqual({
      id: 5, kind: "public", senderId: "vikram", text: "hello",
    });
  });

  it("maps a private agent action, taking the first recipient", () => {
    const event = baseEvent({ visibility: "private", recipients: ["meera"] });
    expect(mapEvent(event)).toEqual({
      id: 5, kind: "private", senderId: "vikram", recipientId: "meera", text: "hello",
    });
  });

  it("maps a confession", () => {
    const event = baseEvent({ kind: "confession", visibility: "private", recipients: [] });
    expect(mapEvent(event)).toEqual({
      id: 5, kind: "confession", senderId: "vikram", text: "hello",
    });
  });

  it("maps a GM ruling and a GM announcement to the same gm command shape", () => {
    expect(mapEvent(baseEvent({ kind: "gm_ruling", sender_id: "game_master" }))).toEqual({
      id: 5, kind: "gm", text: "hello",
    });
    expect(mapEvent(baseEvent({ kind: "gm_announcement", sender_id: "game_master" }))).toEqual({
      id: 5, kind: "gm", text: "hello",
    });
  });

  it("maps a leak event to a sender-attributed leak bubble", () => {
    const event = baseEvent({
      kind: "leak", sender_id: "game_master", text: 'It has been leaked that Vikram said "Ally?" to Meera.',
    });
    expect(mapEvent(event)).toEqual({
      id: 5,
      kind: "leak",
      senderId: "game_master",
      text: 'It has been leaked that Vikram said "Ally?" to Meera.',
    });
  });

  it("returns null for narration", () => {
    expect(mapEvent(baseEvent({ kind: "narration" }))).toBeNull();
  });

  it("returns null for an unrecognized kind", () => {
    expect(mapEvent(baseEvent({ kind: "something_new" }))).toBeNull();
  });
});
