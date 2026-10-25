import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TcProvider, useTcBindings } from "@/components/therapy-compass/bindings";

// Design audit D-03: a Therapies search that looks like it holds a patient detail is not
// written into the page address (`?q=…&run=1`); ordinary searches still navigate.

const navState = vi.hoisted(() => ({
  pathname: "/therapy-compass",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: navState.push, replace: navState.replace, prefetch: () => {} }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  navState.push.mockReset();
  navState.replace.mockReset();
});

function SubmitProbe({ text }: { text: string }) {
  const bindings = useTcBindings();
  return (
    <button type="button" onClick={() => bindings.submitQuery(text)}>
      Submit
    </button>
  );
}

function renderProbe(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  render(
    <TcProvider>
      <SubmitProbe text={text} />
    </TcProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
}

describe("Therapies submitQuery patient-detail check", () => {
  it("keeps a search holding a record number out of the address", () => {
    renderProbe("CBT for psychosis MRN: 1234567");
    expect(navState.push).not.toHaveBeenCalled();
  });

  it("still navigates for an ordinary search", () => {
    renderProbe("CBT for psychosis");
    const written = navState.push.mock.calls.at(-1)?.[0];
    const destination = new URL(String(written), "http://localhost");
    expect(destination.searchParams.get("q")).toBe("CBT for psychosis");
    expect(destination.searchParams.get("run")).toBe("1");
  });
});
