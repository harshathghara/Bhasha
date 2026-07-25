import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShowSetup from "./ShowSetup";
import * as api from "../api/client";

const CAST = [
  "Vikram Sethi — The Creditor",
  "Priya Malhotra — The Wife",
  "Arjun Mehta — The Lawyer",
  "Karan Malhotra — The Brother",
  "Meena Devi — The Househelp",
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ShowSetup", () => {
  it("starts with all five selected so submit is enabled", () => {
    render(<ShowSetup onCreated={() => {}} />);
    const submit = screen.getByRole("button", { name: /start show/i });
    expect(submit).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText(CAST[0]));
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText(CAST[0]));
    expect(submit).not.toBeDisabled();
  });

  it("submits murder defaults and the five cast ids", async () => {
    const spy = vi.spyOn(api, "createShow").mockResolvedValue({ id: "sheesha-ghar" });
    const onCreated = vi.fn();

    render(<ShowSetup onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/number of rounds/i), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "sheesha-ghar" }));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sheesha Ghar - Who Takes the Blame",
        max_rounds: 6,
        agent_preset_ids: [
          "creditor", "wife", "lawyer", "brother", "househelp",
        ],
      })
    );
    expect(spy.mock.calls[0][0].show_prompt).toContain("Ramesh Malhotra");
  });

  it("sends null rounds when the field is left blank", async () => {
    const spy = vi.spyOn(api, "createShow").mockResolvedValue({ id: "sheesha-ghar" });

    render(<ShowSetup onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ max_rounds: null }));
  });
});
