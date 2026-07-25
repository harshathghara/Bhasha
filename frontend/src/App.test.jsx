import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

vi.mock("./pages/WorldPage", () => ({
  default: vi.fn(() => <div data-testid="world-page-stub" />),
}));

describe("App", () => {
  it("shows the setup placeholder by default", () => {
    render(<App />);
    expect(screen.getByText(/show setup flow goes here/i)).toBeInTheDocument();
    expect(screen.queryByTestId("world-page-stub")).not.toBeInTheDocument();
  });

  it("switches to the world view and back", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /view world/i }));
    expect(screen.getByTestId("world-page-stub")).toBeInTheDocument();
    expect(screen.queryByText(/show setup flow goes here/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show setup/i }));
    expect(screen.getByText(/show setup flow goes here/i)).toBeInTheDocument();
  });

  it("disables the button for the currently active view", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /show setup/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /view world/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /view world/i }));
    expect(screen.getByRole("button", { name: /view world/i })).toBeDisabled();
  });
});
