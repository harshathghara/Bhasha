import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import WorldPage from "./pages/WorldPage";
import * as api from "./api/client";

vi.mock("./pages/WorldPage", () => ({
  default: vi.fn(({ onEndGame }) => (
    <button type="button" data-testid="world-page-stub" onClick={onEndGame}>
      End game
    </button>
  )),
}));

describe("App", () => {
  it("shows ShowSetup first, then WorldPage once a show is created", async () => {
    vi.spyOn(api, "createShow").mockResolvedValue({ id: "bhram", contestants: [] });
    render(<App />);

    expect(screen.queryByTestId("world-page-stub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start show/i })).toBeInTheDocument();
    // Murder cast is pre-selected; do not toggle the checkboxes (that would deselect them).
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(screen.getByTestId("world-page-stub")).toBeInTheDocument());
    const props = WorldPage.mock.calls[WorldPage.mock.calls.length - 1][0];
    expect(props.show.id).toBe("bhram");
  });

  it("returns to a fresh show setup after the game ends", async () => {
    vi.spyOn(api, "createShow").mockResolvedValue({ id: "bhram", contestants: [] });
    render(<App />);

    // Murder cast is pre-selected; do not toggle the checkboxes (that would deselect them).
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await screen.findByTestId("world-page-stub");
    fireEvent.click(screen.getByRole("button", { name: /end game/i }));

    expect(screen.queryByTestId("world-page-stub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start show/i })).toBeInTheDocument();
    expect(screen.getByTestId("show-title")).toHaveTextContent("Bhram");
  });
});
