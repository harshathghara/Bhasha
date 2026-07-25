import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import WorldPage from "./pages/WorldPage";
import * as api from "./api/client";

vi.mock("./pages/WorldPage", () => ({
  default: vi.fn(() => <div data-testid="world-page-stub" />),
}));

describe("App", () => {
  it("shows ShowSetup first, then WorldPage once a show is created", async () => {
    vi.spyOn(api, "createShow").mockResolvedValue({ id: "sheesha-ghar", contestants: [] });
    render(<App />);

    expect(screen.queryByTestId("world-page-stub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start show/i })).toBeInTheDocument();

    const names = [
      "Vikram Sethi — The Creditor",
      "Priya Malhotra — The Wife",
      "Arjun Mehta — The Lawyer",
      "Karan Malhotra — The Brother",
      "Meena Devi — The Househelp",
    ];
    names.forEach((name) => fireEvent.click(screen.getByLabelText(name)));
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(screen.getByTestId("world-page-stub")).toBeInTheDocument());
    const props = WorldPage.mock.calls[WorldPage.mock.calls.length - 1][0];
    expect(props.show.id).toBe("sheesha-ghar");
  });
});
