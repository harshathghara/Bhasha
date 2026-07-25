import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("./pages/WorldPage", () => ({
  default: vi.fn(() => <div data-testid="world-page-stub" />),
}));

describe("App", () => {
  it("renders the world page", () => {
    render(<App />);
    expect(screen.getByTestId("world-page-stub")).toBeInTheDocument();
  });
});
