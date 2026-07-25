import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LiveRoom from "./LiveRoom";
import * as api from "../api/client";

const show = {
  id: "sheesha-ghar",
  title: "Sheesha Ghar",
  current_round: 0,
  contestants: [
    { id: "vikram", name: "Vikram", status: "active" },
    { id: "meera", name: "Meera", status: "warned" },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("LiveRoom", () => {
  it("renders the roster with names and statuses", () => {
    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    expect(screen.getByText("Vikram")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("warned")).toBeInTheDocument();
  });

  it("start round calls the API and reports the result", async () => {
    const spy = vi.spyOn(api, "startRound").mockResolvedValue({ round: 1, narrative: "x" });
    const onShowUpdated = vi.fn();

    render(<LiveRoom show={show} onShowUpdated={onShowUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: /start round/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("sheesha-ghar"));
    expect(onShowUpdated).toHaveBeenCalled();
  });

  it("stop round calls the stop API", async () => {
    const spy = vi.spyOn(api, "stopRound").mockResolvedValue({ stopped: true });

    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /stop round/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("sheesha-ghar"));
  });

  it("kill calls killAgent for that contestant", async () => {
    const spy = vi.spyOn(api, "killAgent")
      .mockResolvedValue({ id: "vikram", status: "eliminated" });

    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /kill vikram/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("sheesha-ghar", "vikram"));
  });
});
