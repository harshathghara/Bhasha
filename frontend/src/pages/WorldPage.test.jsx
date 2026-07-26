import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import WorldPage, { buildCharacters } from "./WorldPage";
import WorldView from "../components/WorldView";
import * as api from "../api/client";

let latestDialogueBusyChange = null;

vi.mock("../components/WorldView", () => ({
  default: vi.fn(({ onDialogueBusyChange }) => {
    latestDialogueBusyChange = onDialogueBusyChange;
    return <div data-testid="world-view-stub" />;
  }),
}));

const show = {
  id: "sheesha-ghar",
  max_rounds: 3,
  status: "live",
  narratives: {},
  contestants: [
    { id: "creditor", name: "Vikram Sethi — The Creditor" },
    { id: "wife", name: "Priya Malhotra — The Wife" },
    { id: "lawyer", name: "Arjun Mehta — The Lawyer" },
    { id: "brother", name: "Karan Malhotra — The Brother" },
    { id: "househelp", name: "Meena Devi — The Househelp" },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  latestDialogueBusyChange = null;
});

describe("buildCharacters", () => {
  it("assigns spriteKey by position and keeps the real contestant id/name", () => {
    const characters = buildCharacters(show);
    expect(characters).toHaveLength(5);
    expect(characters[0]).toMatchObject({
      id: "creditor", name: "Vikram Sethi — The Creditor", spriteKey: "slot-1",
    });
    expect(characters[4]).toMatchObject({
      id: "househelp", name: "Meena Devi — The Househelp", spriteKey: "slot-5",
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
      "creditor", "wife", "lawyer", "brother", "househelp",
    ]);
  });

  it("shows the round-end modal with recap when a round finishes", async () => {
    vi.spyOn(api, "startRound").mockResolvedValue({
      round: 1,
      recap: "Heat shifted onto Karan; blame not sealed.",
      narrative: "Priya watched as Karan took the room's fury.",
    });
    render(<WorldPage show={show} />);

    fireEvent.click(screen.getByRole("button", { name: /start round/i }));

    expect(await screen.findByTestId("round-end-modal")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /round 1 ended/i })).toBeInTheDocument();
    expect(screen.getByTestId("round-end-recap")).toHaveTextContent(
      "Heat shifted onto Karan; blame not sealed.",
    );
  });

  it("waits for in-world dialogue to finish before showing the modal", async () => {
    vi.spyOn(api, "startRound").mockResolvedValue({
      round: 1,
      recap: "Recap waits for bubbles.",
      narrative: "Story waits for bubbles.",
    });
    render(<WorldPage show={show} />);
    await waitFor(() => expect(latestDialogueBusyChange).toEqual(expect.any(Function)));

    act(() => {
      latestDialogueBusyChange(true);
    });

    fireEvent.click(screen.getByRole("button", { name: /start round/i }));

    await waitFor(() => expect(api.startRound).toHaveBeenCalled());
    expect(screen.queryByTestId("round-end-modal")).not.toBeInTheDocument();

    act(() => {
      latestDialogueBusyChange(false);
    });

    expect(await screen.findByTestId("round-end-modal")).toBeInTheDocument();
    expect(screen.getByTestId("round-end-recap")).toHaveTextContent("Recap waits for bubbles.");
  });

  it("starts the next round from the modal", async () => {
    const spy = vi.spyOn(api, "startRound")
      .mockResolvedValueOnce({ round: 1, recap: "Recap one.", narrative: "Story one." })
      .mockResolvedValueOnce({ round: 2, recap: "Recap two.", narrative: "Story two." });
    render(<WorldPage show={show} />);

    fireEvent.click(screen.getByRole("button", { name: /start round/i }));
    expect(await screen.findByTestId("round-end-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start next round/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: /round 2 ended/i })).toBeInTheDocument();
    expect(screen.getByTestId("round-end-recap")).toHaveTextContent("Recap two.");
  });

  it("toggles story so far with all round narratives", async () => {
    vi.spyOn(api, "startRound").mockResolvedValue({
      round: 1,
      recap: "Status one.",
      narrative: "Story chapter one with Priya.",
    });
    vi.spyOn(api, "getShow").mockResolvedValue({
      ...show,
      narratives: {
        1: "Story chapter one with Priya.",
        2: "Story chapter two from server.",
      },
    });
    render(<WorldPage show={show} />);

    fireEvent.click(screen.getByRole("button", { name: /start round/i }));
    await screen.findByTestId("round-end-modal");

    fireEvent.click(screen.getByRole("button", { name: /story so far/i }));

    const story = await screen.findByTestId("story-so-far");
    expect(story).toHaveTextContent("Story chapter one with Priya.");
    expect(story).toHaveTextContent("Story chapter two from server.");
    expect(screen.getByTestId("round-end-recap")).toHaveTextContent("Status one.");
  });

  it("disables next round when the show hits its round limit", async () => {
    vi.spyOn(api, "startRound").mockResolvedValue({
      round: 3,
      recap: "Final status.",
      narrative: "Final chapter.",
    });
    render(<WorldPage show={{ ...show, max_rounds: 3 }} />);

    fireEvent.click(screen.getByRole("button", { name: /start round/i }));
    await screen.findByTestId("round-end-modal");

    expect(screen.getByRole("button", { name: /show over/i })).toBeDisabled();
  });

  it("ends the game from the modal and delegates resetting the app", async () => {
    vi.spyOn(api, "startRound").mockResolvedValue({
      round: 1,
      narrative: "Recap one.",
    });
    const endSpy = vi.spyOn(api, "endShow").mockResolvedValue({
      ...show,
      status: "ended",
    });
    const onEndGame = vi.fn();
    render(<WorldPage show={show} onEndGame={onEndGame} />);

    fireEvent.click(screen.getByRole("button", { name: /start round/i }));
    await screen.findByTestId("round-end-modal");

    fireEvent.click(screen.getByRole("button", { name: /end game/i }));

    await waitFor(() => expect(endSpy).toHaveBeenCalledWith("sheesha-ghar"));
    expect(onEndGame).toHaveBeenCalledTimes(1);
  });
});
