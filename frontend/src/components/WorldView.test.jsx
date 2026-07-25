import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import WorldView, {
  bubblePlacement,
  characterNamePlacement,
  chatKindLabel,
  colorForSender,
  shortCharacterName,
} from "./WorldView";
import { speechLabelFromEvent } from "../world/speechStyles";
import { WorldEngine } from "../world/engine";
import { loadImage } from "../world/sprites";
import { openEventSocket, leakEvent } from "../api/client";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";

vi.mock("../world/engine", () => ({
  WorldEngine: vi.fn().mockImplementation(() => ({
    start: vi.fn(), stop: vi.fn(), handleEvent: vi.fn(),
  })),
}));

vi.mock("../world/sprites", async () => {
  const actual = await vi.importActual("../world/sprites");
  return {
    ...actual,
    loadImage: vi.fn(),
  };
});

vi.mock("../api/client", () => ({
  openEventSocket: vi.fn(),
  leakEvent: vi.fn(),
}));

const characters = [
  { id: "slot-1", name: "Housemate 1", spriteKey: "slot-1", tileX: 1, tileY: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  loadImage.mockResolvedValue({});
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});
  openEventSocket.mockReturnValue({ close: vi.fn() });
});

describe("bubblePlacement", () => {
  it("clamps bubbles near the left and right edges", () => {
    const left = bubblePlacement(0, 128);
    const right = bubblePlacement((MAP_WIDTH - 1) * TILE_SIZE, 128);
    expect(left.left).toBeGreaterThanOrEqual(14);
    expect(right.left).toBeLessThanOrEqual(86);
    expect(left.flipBelow).toBe(false);
  });

  it("flips below the character near the top edge", () => {
    const top = bubblePlacement(160, 0);
    expect(top.flipBelow).toBe(true);
    expect(top.transform).toContain("8px");
  });
});

describe("character labels", () => {
  it("uses only the first name for character nameplates", () => {
    expect(shortCharacterName("Vikram Sethi — The Creditor")).toBe("Vikram");
    expect(shortCharacterName("Short")).toBe("Short");
  });

  it("centers nameplates above character sprites", () => {
    const placement = characterNamePlacement(32, 32);
    expect(placement.left).toBeTruthy();
    expect(placement.transform).toContain("-100%");
  });
});

describe("WorldView", () => {
  it("renders a canvas sized to the map", () => {
    render(<WorldView showId="s1" characters={characters} />);
    const canvas = screen.getByTestId("world-canvas");
    expect(canvas.width).toBe(MAP_WIDTH * TILE_SIZE);
    expect(canvas.height).toBe(MAP_HEIGHT * TILE_SIZE);
  });

  it("starts the engine and opens the event socket for the given show", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;
    expect(instance.start).toHaveBeenCalledTimes(1);
    expect(openEventSocket).toHaveBeenCalledWith("s1", expect.any(Function));
  });

  it("forwards socket events into the engine", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;
    const onEvent = openEventSocket.mock.calls[0][1];

    const event = { seq: 1, sender_id: "slot-1", kind: "agent_action", visibility: "public", text: "hi" };
    act(() => {
      onEvent(event);
    });

    expect(instance.handleEvent).toHaveBeenCalledWith(event);
  });

  it("appends every socket event to the side chat with full text", async () => {
    const cast = [
      { id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 },
      { id: "wife", name: "Priya", spriteKey: "slot-2", tileX: 2, tileY: 1 },
    ];
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    const longText = "A".repeat(120);
    act(() => {
      onEvent({
        seq: 1, sender_id: "creditor", kind: "agent_action",
        visibility: "public", recipients: [], text: longText,
      });
      onEvent({
        seq: 2, sender_id: "wife", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "secret deal",
      });
      onEvent({
        seq: 3, sender_id: "wife", kind: "confession",
        visibility: "private", recipients: [], text: "I saw him near the glass.",
      });
      onEvent({
        seq: 4, sender_id: "game_master", kind: "gm_ruling",
        visibility: "public", recipients: [], text: "Stay on topic.",
      });
      onEvent({
        seq: 5, sender_id: "narrator", kind: "narration",
        visibility: "public", recipients: [], text: "The house goes quiet.",
      });
    });

    expect(screen.getByTestId("world-chat")).toBeInTheDocument();
    expect(screen.getByTestId("chat-text-seq-1")).toHaveTextContent(longText);
    expect(screen.getByTestId("chat-entry-seq-2")).toHaveAttribute("data-speech-kind", "private");
    expect(screen.getByTestId("chat-kind-seq-2")).toHaveTextContent("PRIVATE");
    expect(screen.getByTestId("chat-entry-seq-2")).toHaveTextContent("→ Vikram");
    expect(screen.getByTestId("chat-entry-seq-3")).toHaveAttribute("data-speech-kind", "confession");
    expect(screen.getByTestId("chat-kind-seq-3")).toHaveTextContent("CONFESSION");
    expect(screen.getByTestId("chat-entry-seq-4")).toHaveAttribute("data-speech-kind", "gm");
    expect(screen.getByTestId("chat-kind-seq-4")).toHaveTextContent("GM RULING");
    expect(screen.getByTestId("chat-entry-seq-5")).toHaveAttribute("data-speech-kind", "narration");
    expect(screen.getByTestId("chat-kind-seq-5")).toHaveTextContent("NARRATION");
    expect(screen.getByTestId("chat-entry-seq-1")).toHaveAttribute("data-sender", "creditor");
    expect(screen.getByTestId("chat-entry-seq-1")).toHaveAttribute(
      "data-sender-color",
      colorForSender("creditor", ["creditor", "wife"]),
    );
    const chatList = screen.getByTestId("chat-entry-seq-1").parentElement;
    expect(chatList).toHaveStyle({ minHeight: "0" });
    expect(screen.getByTestId("chat-entry-seq-1")).toHaveStyle({ flexShrink: "0" });
    expect(colorForSender("creditor", ["creditor", "wife"]))
      .not.toBe(colorForSender("wife", ["creditor", "wife"]));
    expect(chatKindLabel({ kind: "gm_announcement" })).toBe("GM");
    expect(speechLabelFromEvent({ kind: "gm_announcement" })).toBe("GM");
  });

  it("stops the engine and closes the socket on unmount", async () => {
    const close = vi.fn();
    openEventSocket.mockReturnValue({ close });
    const { unmount } = render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;

    unmount();

    expect(instance.stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("shows a fallback message when assets fail to load", async () => {
    loadImage.mockRejectedValue(new Error("404"));
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("404");
  });

  it("renders a bubble for a character reported with one, and a GM banner", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const { onFrame } = WorldEngine.mock.calls[0][3];

    act(() => {
      onFrame({
        characters: [{
          id: "slot-1", pixelX: 32, pixelY: 32, mode: "interacting",
          bubble: { kind: "private", text: "psst" },
        }],
        gmBanner: { text: "Vikram is warned." },
      });
    });

    expect(await screen.findByTestId("bubble-slot-1")).toHaveTextContent("psst");
    expect(screen.getByTestId("bubble-slot-1")).toHaveAttribute("data-speech-kind", "private");
    expect(screen.getByTestId("bubble-kind-slot-1")).toHaveTextContent("PRIVATE");
    expect(screen.getByTestId("bubble-portrait-slot-1")).toBeInTheDocument();
    expect(screen.getByTestId("bubble-tail-slot-1")).toBeInTheDocument();
    expect(screen.queryByTestId("nameplate-slot-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("bubble-slot-1").textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(screen.getByTestId("gm-banner")).toHaveTextContent("Vikram is warned.");
    expect(screen.getByTestId("gm-banner")).toHaveAttribute("data-speech-kind", "gm");
  });

  it("styles public bubbles with the public kind strip and no emoji", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const { onFrame } = WorldEngine.mock.calls[0][3];

    act(() => {
      onFrame({
        characters: [{
          id: "slot-1", pixelX: 160, pixelY: 128, mode: "interacting",
          bubble: { kind: "public", text: "hello house" },
        }],
        gmBanner: null,
      });
    });

    const bubble = await screen.findByTestId("bubble-slot-1");
    expect(bubble).toHaveAttribute("data-speech-kind", "public");
    expect(screen.getByTestId("bubble-kind-slot-1")).toHaveTextContent("PUBLIC");
    expect(bubble.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("renders colored nameplates above every character in the frame", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const { onFrame } = WorldEngine.mock.calls[0][3];

    act(() => {
      onFrame({
        characters: [{
          id: "slot-1", pixelX: 48, pixelY: 64, mode: "wandering", bubble: null,
        }],
        gmBanner: null,
      });
    });

    const nameplate = await screen.findByTestId("nameplate-slot-1");
    expect(nameplate).toHaveTextContent("Housemate");
    expect(nameplate).toHaveAttribute("data-sender", "slot-1");
    expect(nameplate).toHaveAttribute(
      "data-sender-color",
      colorForSender("slot-1", ["slot-1"]),
    );
  });

  it("flips an edge bubble below the character so it stays in view", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const { onFrame } = WorldEngine.mock.calls[0][3];

    act(() => {
      onFrame({
        characters: [{
          id: "slot-1", pixelX: 0, pixelY: 0, mode: "interacting",
          bubble: { kind: "public", text: "edge" },
        }],
        gmBanner: null,
      });
    });

    const bubble = await screen.findByTestId("bubble-slot-1");
    expect(bubble).toHaveAttribute("data-placement", "below");
  });

  it("filters the chat log by sender name and by message type", async () => {
    const cast = [
      { id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 },
      { id: "wife", name: "Priya", spriteKey: "slot-2", tileX: 2, tileY: 1 },
    ];
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 1, sender_id: "creditor", kind: "agent_action",
        visibility: "public", recipients: [], text: "Public from Vikram.",
      });
      onEvent({
        seq: 2, sender_id: "wife", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private from Priya.",
      });
    });

    expect(screen.getByTestId("chat-entry-seq-1")).toBeInTheDocument();
    expect(screen.getByTestId("chat-entry-seq-2")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("chat-filter-name"), { target: { value: "wife" } });
    expect(screen.queryByTestId("chat-entry-seq-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-entry-seq-2")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("chat-filter-name"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("chat-filter-type"), { target: { value: "private" } });
    expect(screen.queryByTestId("chat-entry-seq-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-entry-seq-2")).toBeInTheDocument();
  });

  it("shows a Leak button only for private/confession entries not yet leaked", async () => {
    const cast = [{ id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 }];
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 1, sender_id: "creditor", kind: "agent_action",
        visibility: "public", recipients: [], text: "Public.",
      });
      onEvent({
        seq: 2, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private.", released: false,
      });
      onEvent({
        seq: 3, sender_id: "creditor", kind: "confession",
        visibility: "private", recipients: [], text: "Confession.", released: false,
      });
      onEvent({
        seq: 4, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Already leaked.", released: true,
      });
    });

    expect(screen.queryByTestId("leak-button-seq-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("leak-button-seq-2")).toBeInTheDocument();
    expect(screen.getByTestId("leak-button-seq-3")).toBeInTheDocument();
    expect(screen.queryByTestId("leak-button-seq-4")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-leaked-badge-seq-4")).toBeInTheDocument();
  });

  it("leaks a message through the confirm dialog and flips its badge", async () => {
    const cast = [{ id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 }];
    leakEvent.mockResolvedValue({ seq: 2, released: true });
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 2, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private.", released: false,
      });
    });

    fireEvent.click(screen.getByTestId("leak-button-seq-2"));
    const dialog = screen.getByTestId("leak-confirm-dialog");
    expect(dialog).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /^leak$/i }));
      await Promise.resolve();
    });

    expect(leakEvent).toHaveBeenCalledWith("s1", 2);
    expect(screen.queryByTestId("leak-confirm-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-leaked-badge-seq-2")).toBeInTheDocument();
    expect(screen.queryByTestId("leak-button-seq-2")).not.toBeInTheDocument();
  });

  it("reconciles an agent-driven leak delivered purely over the socket", async () => {
    const cast = [{ id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 }];
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 2, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private.", released: false,
      });
    });

    expect(screen.getByTestId("leak-button-seq-2")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-leaked-badge-seq-2")).not.toBeInTheDocument();

    // Simulate the backend's LEAK event arriving over the socket, as it would
    // when an agent's own tool call leaked the message (no button click, no
    // HTTP response involved).
    act(() => {
      onEvent({
        seq: 3, sender_id: "vikram", kind: "leak",
        visibility: "public", recipients: [], text: "It has been leaked...",
        leaked_from_seq: 2,
      });
    });

    expect(leakEvent).not.toHaveBeenCalled();
    expect(screen.queryByTestId("leak-button-seq-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-leaked-badge-seq-2")).toBeInTheDocument();
  });

  it("shows an inline error when leaking fails", async () => {
    const cast = [{ id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 }];
    leakEvent.mockRejectedValue(new Error("Event has already been leaked"));
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 2, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private.", released: false,
      });
    });

    fireEvent.click(screen.getByTestId("leak-button-seq-2"));
    const dialog = screen.getByTestId("leak-confirm-dialog");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /^leak$/i }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("leak-confirm-error")).toHaveTextContent(
      "Event has already been leaked",
    );
    expect(screen.getByTestId("leak-confirm-dialog")).toBeInTheDocument();
  });
});
