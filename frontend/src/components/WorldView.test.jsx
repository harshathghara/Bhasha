import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import WorldView, {
  bubblePlacement,
  chatKindLabel,
  colorForSender,
} from "./WorldView";
import { WorldEngine } from "../world/engine";
import { loadImage } from "../world/sprites";
import { openEventSocket } from "../api/client";
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
    expect(screen.getByTestId("chat-entry-seq-2")).toHaveTextContent("private");
    expect(screen.getByTestId("chat-entry-seq-2")).toHaveTextContent("→ Vikram");
    expect(screen.getByTestId("chat-entry-seq-3")).toHaveTextContent("confession");
    expect(screen.getByTestId("chat-entry-seq-4")).toHaveTextContent("Game Master");
    expect(screen.getByTestId("chat-entry-seq-5")).toHaveTextContent("narration");
    expect(screen.getByTestId("chat-entry-seq-1")).toHaveAttribute("data-sender", "creditor");
    expect(colorForSender("creditor", ["creditor", "wife"]))
      .not.toBe(colorForSender("wife", ["creditor", "wife"]));
    const chatList = screen.getByTestId("chat-entry-seq-1").parentElement;
    expect(chatList).toHaveStyle({ minHeight: "0" });
    expect(screen.getByTestId("chat-entry-seq-1")).toHaveStyle({ flexShrink: "0" });
    expect(chatKindLabel({ kind: "gm_announcement" })).toBe("gm");
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
    expect(screen.getByTestId("bubble-portrait-slot-1")).toBeInTheDocument();
    expect(screen.getByTestId("bubble-tail-slot-1")).toBeInTheDocument();
    expect(screen.getByTestId("gm-banner")).toHaveTextContent("Vikram is warned.");
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
});
