import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createShow, getShow, startRound, stopRound, endShow, killAgent, releaseEvent,
  leakEvent, injectEvent,
} from "./client";

beforeEach(() => {
  global.fetch = vi.fn();
});

function ok(data) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}

describe("api client", () => {
  it("createShow posts to /shows", async () => {
    global.fetch.mockReturnValue(ok({ id: "sheesha-ghar" }));
    const result = await createShow({ title: "Sheesha Ghar", agent_preset_ids: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ id: "sheesha-ghar" });
  });

  it("getShow fetches the show", async () => {
    global.fetch.mockReturnValue(ok({ id: "sheesha-ghar" }));
    await getShow("sheesha-ghar");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar")
    );
  });

  it("startRound, stopRound, and endShow hit their routes", async () => {
    global.fetch.mockReturnValue(ok({ round: 1, narrative: "x" }));
    await startRound("sheesha-ghar");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/rounds"),
      expect.objectContaining({ method: "POST" })
    );

    global.fetch.mockReturnValue(ok({ round: 2, narrative: "y" }));
    await startRound("sheesha-ghar", { opening_brief: "Footprints by the door." });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/rounds"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ opening_brief: "Footprints by the door." }),
      })
    );

    global.fetch.mockReturnValue(ok({ stopped: true }));
    await stopRound("sheesha-ghar");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/stop"),
      expect.objectContaining({ method: "POST" })
    );

    global.fetch.mockReturnValue(ok({ id: "sheesha-ghar", status: "ended" }));
    await endShow("sheesha-ghar");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/end"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("killAgent hits the kill route", async () => {
    global.fetch.mockReturnValue(ok({ status: "eliminated" }));
    await killAgent("sheesha-ghar", "vikram");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/agents/vikram/kill"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("releaseEvent posts to the event release route", async () => {
    global.fetch.mockReturnValue(ok({ seq: 3, released: true }));
    const result = await releaseEvent("sheesha-ghar", 3);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/events/3/release"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result.released).toBe(true);
  });

  it("leakEvent posts to the event leak route", async () => {
    global.fetch.mockReturnValue(ok({ seq: 3, released: true }));
    const result = await leakEvent("sheesha-ghar", 3);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/events/3/leak"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result.released).toBe(true);
  });

  it("injectEvent posts a producer note to the events route", async () => {
    global.fetch.mockReturnValue(ok({ seq: 4, kind: "producer_note" }));
    const result = await injectEvent("sheesha-ghar", "A bloody handkerchief.");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/events"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result.kind).toBe("producer_note");
  });

  it("throws when a response is not ok", async () => {
    global.fetch.mockReturnValue(
      Promise.resolve({ ok: false, json: () => Promise.resolve({ detail: "nope" }) })
    );
    await expect(getShow("missing")).rejects.toThrow("nope");
  });
});
