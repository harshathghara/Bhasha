import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import WorldPage, { buildCharacters } from "./WorldPage";
import WorldView from "../components/WorldView";
import * as api from "../api/client";

vi.mock("../components/WorldView", () => ({
  default: vi.fn(() => <div data-testid="world-view-stub" />),
}));

const show = {
  id: "sheesha-ghar",
  contestants: [
    { id: "strategist", name: "The Strategist" },
    { id: "diplomat", name: "The Diplomat" },
    { id: "loyalist", name: "The Loyalist" },
    { id: "operator", name: "The Operator" },
    { id: "wildcard", name: "The Wildcard" },
  ],
};

describe("buildCharacters", () => {
  it("assigns spriteKey by position and keeps the real contestant id/name", () => {
    const characters = buildCharacters(show);
    expect(characters).toHaveLength(5);
    expect(characters[0]).toMatchObject({
      id: "strategist", name: "The Strategist", spriteKey: "slot-1",
    });
    expect(characters[4]).toMatchObject({
      id: "wildcard", name: "The Wildcard", spriteKey: "slot-5",
    });
    expect(new Set(characters.map((c) => `${c.tileX},${c.tileY}`)).size).toBe(5);
  });
});

describe("WorldPage", () => {
  it("renders WorldView with the show's id and real contestants", () => {
    render(<WorldPage show={show} />);
    const props = WorldView.mock.calls[0][0];
    expect(props.showId).toBe("sheesha-ghar");
    expect(props.characters.map((c) => c.id)).toEqual([
      "strategist", "diplomat", "loyalist", "operator", "wildcard",
    ]);
  });

  it("starts the round when Start round is clicked", async () => {
    const spy = vi.spyOn(api, "startRound").mockResolvedValue({ round: 1, narrative: "x" });
    render(<WorldPage show={show} />);

    fireEvent.click(screen.getByRole("button", { name: /start round/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("sheesha-ghar"));
  });
});
