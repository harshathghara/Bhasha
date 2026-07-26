import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LiveRoom from "./LiveRoom";
import * as api from "../api/client";

const show = {
  id: "bhram",
  title: "Bhram",
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

    await waitFor(() => expect(spy).toHaveBeenCalledWith("bhram", {}));
    expect(onShowUpdated).toHaveBeenCalled();
  });

  it("start round sends opening brief and clears the field", async () => {
    const spy = vi.spyOn(api, "startRound").mockResolvedValue({ round: 2, narrative: "y" });
    const onShowUpdated = vi.fn();

    render(<LiveRoom show={show} onShowUpdated={onShowUpdated} />);
    fireEvent.change(screen.getByLabelText(/round brief/i), {
      target: { value: "Footprints by the back door." },
    });
    fireEvent.click(screen.getByRole("button", { name: /start round/i }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("bhram", {
        opening_brief: "Footprints by the back door.",
      })
    );
    expect(onShowUpdated).toHaveBeenCalled();
    expect(screen.getByLabelText(/round brief/i)).toHaveValue("");
  });

  it("stop round calls the stop API", async () => {
    const spy = vi.spyOn(api, "stopRound").mockResolvedValue({ stopped: true });

    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /stop round/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("bhram"));
  });

  it("kill calls killAgent for that contestant", async () => {
    const spy = vi.spyOn(api, "killAgent")
      .mockResolvedValue({ id: "vikram", status: "eliminated" });

    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /kill vikram/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("bhram", "vikram"));
  });

  it("inject clue posts text and clears the field", async () => {
    const spy = vi.spyOn(api, "injectEvent").mockResolvedValue({
      seq: 1, kind: "producer_note", text: "A bloody handkerchief.",
    });
    const onShowUpdated = vi.fn();

    render(<LiveRoom show={show} onShowUpdated={onShowUpdated} />);
    fireEvent.change(screen.getByLabelText(/inject public clue/i), {
      target: { value: "A bloody handkerchief." },
    });
    fireEvent.click(screen.getByRole("button", { name: /inject clue/i }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("bhram", "A bloody handkerchief.")
    );
    expect(onShowUpdated).toHaveBeenCalled();
    expect(screen.getByLabelText(/inject public clue/i)).toHaveValue("");
  });
});
