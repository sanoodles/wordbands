// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import WorkspaceClient from "./WorkspaceClient";

vi.mock("./Workspace", () => ({
  default: ({ typedBefore }: { typedBefore: string | null }) => <p>typed: {String(typedBefore)}</p>,
}));

const roots: Root[] = [];

/** The page as it arrives from the server, before any script has run. */
function serverPage(word = "") {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<WorkspaceClient country="DE" word={word} />);
  document.body.append(container);
  return container;
}

async function hydrate(container: HTMLElement, word = "") {
  await act(async () => {
    roots.push(hydrateRoot(container, <WorkspaceClient country="DE" word={word} />));
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  cleanup();
});

describe("the search field in the HTML", () => {
  // @spec LOAD-4
  it("is named, and looks a word up through the URL with no script", () => {
    const form = serverPage().querySelector("form")!;
    const input = form.querySelector("input")!;
    expect(form).toHaveAttribute("action", "/");
    expect(input).toHaveAttribute("name", "word");
    expect(input).toHaveAccessibleName("Look up a word");
  });

  it("shows the word a link names", () => {
    expect(serverPage("Wasser").querySelector("input")).toHaveValue("Wasser");
  });

  // @spec LOAD-4
  it("hands what was typed to the Workspace", async () => {
    const container = serverPage();
    container.querySelector("input")!.value = "hau";
    await hydrate(container);
    expect(screen.getByText("typed: hau")).toBeInTheDocument();
    expect(container.querySelector("input")).toBeNull();
  });

  // @spec LOAD-4
  it("hands a word over changed, and a field emptied", async () => {
    const container = serverPage("Wasser");
    container.querySelector("input")!.value = "";
    await hydrate(container, "Wasser");
    expect(screen.getByText("typed:")).toBeInTheDocument();
  });

  it("hands nothing over when nothing was typed", async () => {
    const container = serverPage("Wasser");
    await hydrate(container, "Wasser");
    expect(screen.getByText("typed: null")).toBeInTheDocument();
  });
});
