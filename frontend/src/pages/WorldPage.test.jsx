import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WorldPage, { PLACEHOLDER_CHARACTERS } from "./WorldPage";
import WorldView from "../components/WorldView";

vi.mock("../components/WorldView", () => ({
  default: vi.fn(() => <div data-testid="world-view-stub" />),
}));

describe("WorldPage", () => {
  it("renders WorldView with the placeholder character list", () => {
    render(<WorldPage />);
    expect(screen.getByTestId("world-view-stub")).toBeInTheDocument();
    const props = WorldView.mock.calls[0][0];
    expect(props.characters).toBe(PLACEHOLDER_CHARACTERS);
  });

  it("has exactly five placeholder characters with unique ids and sprite keys", () => {
    expect(PLACEHOLDER_CHARACTERS).toHaveLength(5);
    expect(new Set(PLACEHOLDER_CHARACTERS.map((c) => c.id)).size).toBe(5);
    expect(new Set(PLACEHOLDER_CHARACTERS.map((c) => c.spriteKey)).size).toBe(5);
  });
});
