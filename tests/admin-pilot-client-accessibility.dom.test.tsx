/** @vitest-environment jsdom */

// Admin NHMRC source pilot: the accessibility contract that
// docs/design-system/evidence/admin-source-pilot.json recorded on 14 Oct
// ("Native labels, keyboard traversal and polite status") against an earlier
// pilot-client digest. This pins it to the current client on every change.
// It is not a screen-reader run.

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const listFactors = vi.hoisted(() => vi.fn());
const enroll = vi.hoisted(() => vi.fn());
const challenge = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());
const getAuthenticatorAssuranceLevel = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/browser-client", () => ({
  browserSupabaseClientFor: () => ({
    auth: { mfa: { listFactors, enroll, challenge, verify, getAuthenticatorAssuranceLevel } },
  }),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- Stand-in for next/image inside jsdom.
  default: ({ alt, src, width, height }: { alt: string; src: string; width?: number; height?: number }) => (
    <img alt={alt} src={src} width={width} height={height} />
  ),
}));

import AdminPilot from "@/app/admin/pilot/pilot-client";
import { LiveAnnouncer, resetAnnouncerForTests } from "@/components/ui/live-announcer";

const verifiedFactor = {
  data: { totp: [{ id: "factor-synthetic", status: "verified", friendly_name: "Synthetic authenticator" }] },
  error: null,
};

function renderPilot() {
  return render(
    <>
      <AdminPilot url="https://synthetic.example" publishableKey="synthetic-key" />
      <LiveAnnouncer />
    </>,
  );
}

afterEach(() => {
  cleanup();
  resetAnnouncerForTests();
  listFactors.mockReset();
  enroll.mockReset();
  challenge.mockReset();
  verify.mockReset();
  getAuthenticatorAssuranceLevel.mockReset();
});

describe("admin source pilot accessibility", () => {
  it("gives every control a native accessible name inside labelled sections", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    renderPilot();

    await screen.findByRole("combobox", { name: /authenticator/i });
    const mfa = within(screen.getByRole("region", { name: /verify your authenticator/i }));
    expect(mfa.getByRole("combobox", { name: /authenticator/i })).toBeTruthy();
    expect(mfa.getByLabelText(/six-digit authenticator code/i)).toBeTruthy();
    expect(mfa.getByRole("button", { name: /verify code/i })).toBeTruthy();

    const upload = within(screen.getByRole("region", { name: /admit one approved pilot source/i }));
    expect(upload.getByRole("combobox", { name: /approved pilot source/i })).toBeTruthy();
    expect(upload.getByLabelText(/reviewed four-page native pdf/i)).toBeTruthy();
    expect(upload.getByRole("checkbox", { name: /operator-approved source authority/i })).toBeTruthy();
    expect(upload.getByRole("button", { name: /admit this pdf/i })).toBeTruthy();
  });

  it("moves keyboard focus through the controls in reading order", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    challenge.mockResolvedValue({ data: { id: "challenge-synthetic" }, error: null });
    verify.mockResolvedValue({ error: null });
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    const user = userEvent.setup();
    renderPilot();
    await waitFor(() =>
      expect(screen.getByLabelText(/six-digit authenticator code/i)).toHaveProperty("disabled", false),
    );
    await user.type(screen.getByLabelText(/six-digit authenticator code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify code/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /admit this pdf/i })).toHaveProperty("disabled", false),
    );
    // Clicking Verify leaves focus on it, so start the walk from the top of the page.
    (document.activeElement as HTMLElement | null)?.blur();

    const expected = [
      screen.getByRole("combobox", { name: /authenticator/i }),
      screen.getByLabelText(/six-digit authenticator code/i),
      screen.getByRole("button", { name: /verify code/i }),
      screen.getByRole("combobox", { name: /approved pilot source/i }),
      screen.getByLabelText(/reviewed four-page native pdf/i),
      screen.getByRole("checkbox", { name: /operator-approved source authority/i }),
      screen.getByRole("button", { name: /admit this pdf/i }),
    ];
    for (const control of expected) {
      await user.tab();
      expect(document.activeElement).toBe(control);
    }
  });

  it("covers the no-factor enrollment control and its keyboard position", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    const user = userEvent.setup();
    renderPilot();

    const setup = await screen.findByRole("button", { name: /set up an authenticator/i });
    expect(setup).toHaveProperty("disabled", false);
    document.body.focus();
    await user.tab();
    expect(document.activeElement).toBe(setup);
  });

  it("updates the file label and submit name for a TXT source", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    const user = userEvent.setup();
    renderPilot();

    await screen.findByRole("combobox", { name: /approved pilot source/i });
    await user.selectOptions(screen.getByRole("combobox", { name: /approved pilot source/i }), "txt");
    expect(screen.getByLabelText(/approved summary txt/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /admit this txt/i })).toBeTruthy();
  });

  it("renders a fail-closed factor read in the shared polite live region", async () => {
    listFactors.mockResolvedValue({ data: null, error: new Error("synthetic") });
    renderPilot();

    const politeRegion = await screen.findByTestId("live-announcer-polite");
    expect(politeRegion).toHaveAttribute("aria-live", "polite");
    await waitFor(() =>
      expect(politeRegion).toHaveTextContent("Authenticator factors could not be read. Sign in again."),
    );
    expect(screen.getByRole("button", { name: /verify code/i })).toHaveProperty("disabled", true);
  });

  it("preserves native HTML form controls, label bindings, and border semantics under dark and forced-colors modes (#54N8ZN)", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("forced-colors: active") || query.includes("prefers-color-scheme: dark"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      const { container } = render(
        <div data-theme="dark" className="dark">
          <AdminPilot url="https://synthetic.example" publishableKey="synthetic-key" />
          <LiveAnnouncer />
        </div>,
      );

      const factorSelect = await screen.findByRole("combobox", { name: /authenticator/i });
      const codeInput = screen.getByLabelText(/six-digit authenticator code/i) as HTMLInputElement;
      const verifyButton = screen.getByRole("button", { name: /verify code/i }) as HTMLButtonElement;
      const sourceSelect = screen.getByRole("combobox", { name: /approved pilot source/i });
      const fileInput = screen.getByLabelText(/reviewed four-page native pdf/i) as HTMLInputElement;
      const confirmCheckbox = screen.getByRole("checkbox", {
        name: /operator-approved source authority/i,
      }) as HTMLInputElement;
      const admitButton = screen.getByRole("button", { name: /admit this pdf/i }) as HTMLButtonElement;

      expect(factorSelect.tagName).toBe("SELECT");
      expect(sourceSelect.tagName).toBe("SELECT");
      expect(codeInput.tagName).toBe("INPUT");
      expect(["text", "password"]).toContain(codeInput.type);
      expect(codeInput.getAttribute("inputMode")).toBe("numeric");
      expect(fileInput.tagName).toBe("INPUT");
      expect(fileInput.type).toBe("file");
      expect(confirmCheckbox.tagName).toBe("INPUT");
      expect(confirmCheckbox.type).toBe("checkbox");
      expect(verifyButton.tagName).toBe("BUTTON");
      expect(verifyButton.type).toBe("submit");
      expect(admitButton.tagName).toBe("BUTTON");
      expect(admitButton.type).toBe("submit");

      for (const control of [factorSelect, codeInput, sourceSelect, fileInput, confirmCheckbox]) {
        const label =
          control.closest("label") ??
          (control.id ? container.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null);
        expect(label).not.toBeNull();
        expect(label?.tagName).toBe("LABEL");
      }

      for (const borderedControl of [factorSelect, codeInput, verifyButton, sourceSelect, admitButton]) {
        expect(borderedControl.className).toContain("border");
      }

      // No custom div/span ARIA widgets that lose system forced-colors borders.
      const customAriaControls = container.querySelectorAll(
        'div[role="combobox"], div[role="checkbox"], div[role="button"], div[role="textbox"], span[role="combobox"], span[role="checkbox"], span[role="button"]',
      );
      expect(customAriaControls).toHaveLength(0);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("maintains 320px narrow-viewport vertical stacking, bounded widths, and QR enrollment alt text + security warning copy (#54N8ZN)", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    enroll.mockResolvedValue({
      data: {
        id: "factor-enrolled-synthetic",
        totp: { qr_code: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>" },
      },
      error: null,
    });
    const user = userEvent.setup();
    const { container } = render(
      <div style={{ width: "320px" }} className="break-all">
        <AdminPilot url="https://synthetic.example" publishableKey="synthetic-key" />
        <LiveAnnouncer />
      </div>,
    );

    const setupButton = await screen.findByRole("button", { name: /set up an authenticator/i });
    await user.click(setupButton);

    const qrImg = await screen.findByRole("img", { name: "Private authenticator enrollment QR code" });
    expect(qrImg).toHaveAttribute("alt", "Private authenticator enrollment QR code");
    expect(Number(qrImg.getAttribute("width"))).toBeLessThanOrEqual(320);
    expect(Number(qrImg.getAttribute("height"))).toBeLessThanOrEqual(320);

    expect(
      screen.getAllByText(
        "Scan this QR code in your own authenticator app. Do not share or screenshot it. Then enter the six-digit code.",
      ).length,
    ).toBeGreaterThanOrEqual(1);

    const pilotRoot = container.querySelector(".space-y-6");
    expect(pilotRoot).not.toBeNull();
    const stackedGroups = container.querySelectorAll(".space-y-3");
    expect(stackedGroups.length).toBeGreaterThanOrEqual(4);

    for (const control of container.querySelectorAll("select, input[type='password'], input[type='file']")) {
      expect(control.className).toContain("min-w-0");
      expect(control.className).toContain("max-w-full");
    }

    for (const element of container.querySelectorAll<HTMLElement>("*")) {
      const widthAttr = element.getAttribute("width");
      if (widthAttr !== null) {
        expect(Number(widthAttr)).toBeLessThanOrEqual(320);
      }
      const inlineWidth = element.style.width;
      if (inlineWidth.endsWith("px")) {
        expect(Number.parseFloat(inlineWidth)).toBeLessThanOrEqual(320);
      }
    }
  });
});
