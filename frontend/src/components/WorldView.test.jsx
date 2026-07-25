import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import WorldView from "./WorldView";
import { WorldEngine } from "../world/engine";
import { loadImage } from "../world/sprites";
import { openEventSocket } from "../api/client";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";

vi.mock("../world/engine", () => ({
  WorldEngine: vi.fn().mockImplementation(() => ({
    start: vi.fn(), stop: vi.fn(), handleEvent: vi.fn(),
  })),
}));

vi.mock("../world/sprites", () => ({
  loadImage: vi.fn(),
}));

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
    onEvent(event);

    expect(instance.handleEvent).toHaveBeenCalledWith(event);
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
    expect(screen.getByTestId("gm-banner")).toHaveTextContent("Vikram is warned.");
  });
});
