import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShowSetup from "./ShowSetup";
import * as api from "../api/client";

const FIVE_NAMES = [
  "Vikram Sethi — The Creditor",
  "Priya Malhotra — The Wife",
  "Arjun Mehta — The Lawyer",
  "Karan Malhotra — The Brother",
  "Meena Devi — The Househelp",
];

beforeEach(() => {
  vi.restoreAllMocks();
});

function selectFive() {
  for (const name of FIVE_NAMES) {
    fireEvent.click(screen.getByLabelText(name));
  }
}

describe("ShowSetup", () => {
  it("disables submit until exactly five agents are selected", () => {
    render(<ShowSetup onCreated={() => {}} />);
    const submit = screen.getByRole("button", { name: /start show/i });
    expect(submit).toBeDisabled();

    selectFive();
    expect(submit).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText(FIVE_NAMES[0]));
    expect(submit).toBeDisabled();
  });

  it("submits prompts, rounds, and agents, then reports the created show", async () => {
    const spy = vi.spyOn(api, "createShow").mockResolvedValue({ id: "sheesha-ghar" });
    const onCreated = vi.fn();

    render(<ShowSetup onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/show title/i), {
      target: { value: "Sheesha Ghar" },
    });
    fireEvent.change(screen.getByLabelText(/number of rounds/i), {
      target: { value: "6" },
    });
    selectFive();
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "sheesha-ghar" }));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sheesha Ghar",
        max_rounds: 6,
        agent_preset_ids: [
          "creditor", "wife", "lawyer", "brother", "househelp",
        ],
      })
    );
  });

  it("sends null rounds when the field is left blank", async () => {
    const spy = vi.spyOn(api, "createShow").mockResolvedValue({ id: "sheesha-ghar" });

    render(<ShowSetup onCreated={() => {}} />);
    selectFive();
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ max_rounds: null }));
  });
});
