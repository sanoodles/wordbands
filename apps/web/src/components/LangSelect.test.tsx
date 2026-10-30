// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LangSelect from "./LangSelect";

const OPTIONS = [
  { code: "en", name: "English" },
  { code: "pt", name: "Português" },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LangSelect", () => {
  it("shows the code, and keeps the endonym as the value assistive tech reads", () => {
    render(<LangSelect label="Source language" value="pt" options={OPTIONS} onChange={() => {}} />);
    const trigger = screen.getByRole("combobox", { name: "Source language" });

    // What is on screen — the endonym beside it is hidden by globals.css, not by CSS
    // that jsdom applies, so assert the elements rather than the rendered text.
    expect(trigger.querySelector(".lang-code")).toHaveTextContent("PT");
    expect(trigger.querySelector(".lang-code")).toHaveAttribute("aria-hidden", "true");

    // What names the current value for a screen reader.
    const endonym = trigger.querySelector(".lang-name");
    expect(endonym).toHaveTextContent("Português");
    expect(endonym).not.toHaveAttribute("aria-hidden");
    expect(endonym).toHaveAttribute("lang", "pt");
  });

  it("names each option by its language and reports the picked code", async () => {
    const onChange = vi.fn();
    render(<LangSelect label="Source language" value="en" options={OPTIONS} onChange={onChange} />);

    await userEvent.click(screen.getByRole("combobox", { name: "Source language" }));
    await userEvent.click(await screen.findByRole("option", { name: "Português" }));

    expect(onChange).toHaveBeenCalledWith("pt");
  });

  // @spec SELECT-1
  it("keeps a finger landing on a row from picking it, and picks on the tap's click", async () => {
    const onChange = vi.fn();
    render(<LangSelect label="Source language" value="en" options={OPTIONS} onChange={onChange} />);

    await userEvent.click(screen.getByRole("combobox", { name: "Source language" }));
    const row = await screen.findByRole("option", { name: "Português" });

    fireEvent.touchStart(row);
    expect(onChange).not.toHaveBeenCalled();
    expect(row).toBeInTheDocument();

    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("pt");
  });

  // @spec SELECT-2
  it("drops a click outside the menu for half a second after a finger lifts off a row", async () => {
    const onChange = vi.fn();
    const onBeneath = vi.fn();
    render(
      <>
        <LangSelect label="Source language" value="en" options={OPTIONS} onChange={onChange} />
        <button onClick={onBeneath}>Beneath</button>
      </>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Source language" }));
    const row = await screen.findByRole("option", { name: "Português" });
    const beneath = screen.getByRole("button", { name: "Beneath" });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith("pt");

    // fireEvent answers false where the default was prevented, which is what stops a link.
    expect(fireEvent.click(beneath)).toBe(false);
    vi.advanceTimersByTime(499);
    expect(fireEvent.click(beneath)).toBe(false);
    expect(onBeneath).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fireEvent.click(beneath)).toBe(true);
    expect(onBeneath).toHaveBeenCalledTimes(1);
  });

  it("leaves a click on the page alone after a pick with a mouse", async () => {
    const onBeneath = vi.fn();
    render(
      <>
        <LangSelect label="Source language" value="en" options={OPTIONS} onChange={() => {}} />
        <button onClick={onBeneath}>Beneath</button>
      </>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Source language" }));
    await userEvent.click(await screen.findByRole("option", { name: "Português" }));

    await userEvent.click(screen.getByRole("button", { name: "Beneath" }));
    expect(onBeneath).toHaveBeenCalledTimes(1);
  });
});
