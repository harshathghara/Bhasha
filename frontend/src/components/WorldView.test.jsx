import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import WorldView from "./WorldView";
import { WorldEngine } from "../world/engine";
import { loadImage } from "../world/sprites";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";

vi.mock("../world/engine", () => ({
  WorldEngine: vi.fn().mockImplementation(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

vi.mock("../world/sprites", () => ({
  loadImage: vi.fn(),
}));

const characters = [
  { id: "slot-1", name: "Housemate 1", spriteKey: "slot-1", tileX: 1, tileY: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  loadImage.mockResolvedValue({});
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});
});

describe("WorldView", () => {
  it("renders a canvas sized to the map", () => {
    render(<WorldView characters={characters} />);
    const canvas = screen.getByTestId("world-canvas");
    expect(canvas.width).toBe(MAP_WIDTH * TILE_SIZE);
    expect(canvas.height).toBe(MAP_HEIGHT * TILE_SIZE);
  });

  it("starts the engine once assets load", async () => {
    render(<WorldView characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;
    expect(instance.start).toHaveBeenCalledTimes(1);
  });

  it("stops the engine on unmount", async () => {
    const { unmount } = render(<WorldView characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;

    unmount();

    expect(instance.stop).toHaveBeenCalledTimes(1);
  });

  it("shows a fallback message when assets fail to load", async () => {
    loadImage.mockRejectedValue(new Error("404"));
    render(<WorldView characters={characters} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("404");
  });
});
