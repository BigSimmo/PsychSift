import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SignedImage backs both DocumentImage (document viewer) and SourceImage (answer
// gallery), so its failure/retry branch — untestable in the node/SSR suite because
// it lives in effects — is exercised here under jsdom. jsdom omits
// IntersectionObserver, so SignedImage loads immediately (its documented fallback),
// which lets us drive the fetch → failed → retry → recover flow directly.

// useSignedImageUrl lists authorizationHeader + markSessionExpired in its effect
// deps, so the mock must return STABLE references — a fresh object/fn per render
// would re-run the fetch effect on every state change and exhaust the one-shot
// fetch mocks below.
vi.mock("@/lib/supabase/client", () => {
  const authorizationHeader = {};
  const markSessionExpired = vi.fn();
  return { useAuthSession: () => ({ authorizationHeader, markSessionExpired }) };
});

import { SignedImage } from "@/components/clinical-dashboard/signed-image";
import { clearSignedUrlCache } from "@/lib/signed-url-cache";

const ENDPOINT = "/api/images/dom-test/signed-url";

beforeEach(() => {
  clearSignedUrlCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearSignedUrlCache();
});

describe("SignedImage failure/retry (jsdom)", () => {
  it("automatically recovers from a transient first-load failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "temporary" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: "/demo/recovered.png" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SignedImage
        endpoint={ENDPOINT}
        alt="Recovered diagram"
        failureLabel="Image preview failed."
        retryLabel="Retry"
      />,
    );

    const img = await screen.findByRole("img", { name: "Recovered diagram" }, { timeout: 2_000 });
    expect(img.getAttribute("src")?.endsWith("/demo/recovered.png")).toBe(true);
    expect(screen.queryByText("Image preview failed.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("automatically recovers from a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: "/demo/network-recovered.png" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<SignedImage endpoint={ENDPOINT} alt="Network recovered diagram" />);

    const img = await screen.findByRole("img", { name: "Network recovered diagram" }, { timeout: 2_000 });
    expect(img.getAttribute("src")?.endsWith("/demo/network-recovered.png")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 404])("does not automatically retry terminal HTTP %s failures", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: "terminal" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<SignedImage endpoint={ENDPOINT} alt="Unavailable diagram" failureLabel="Image preview failed." />);

    expect(await screen.findByText("Image preview failed.", {}, { timeout: 500 })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the default settled fallback visible and reports it once", async () => {
    const onSettledFailure = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "not found" }) }),
    );

    const { rerender } = render(
      <SignedImage
        endpoint={ENDPOINT}
        alt="Missing diagram"
        failureLabel="Image preview failed."
        onSettledFailure={onSettledFailure}
      />,
    );

    expect(await screen.findByText("Image preview failed.")).toBeInTheDocument();
    await waitFor(() => expect(onSettledFailure).toHaveBeenCalledTimes(1));
    expect(onSettledFailure).toHaveBeenCalledWith(
      expect.objectContaining({ source: "response", status: 404, retryable: false }),
    );

    const replacementCallback = vi.fn();
    rerender(
      <SignedImage
        endpoint={ENDPOINT}
        alt="Missing diagram"
        failureLabel="Image preview failed."
        onSettledFailure={replacementCallback}
      />,
    );
    expect(onSettledFailure).toHaveBeenCalledTimes(1);
    expect(replacementCallback).not.toHaveBeenCalled();
  });

  it("hides the fallback and reports only after automatic retries are exhausted", async () => {
    const onSettledFailure = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SignedImage
        endpoint={ENDPOINT}
        alt="Optional cover"
        failureLabel="Cover failed."
        failurePresentation="hidden"
        onSettledFailure={onSettledFailure}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onSettledFailure).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 3_000 });
    await waitFor(() => expect(onSettledFailure).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Cover failed.")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("starts a new settled-failure callback cycle after manual retry", async () => {
    const user = userEvent.setup();
    const onSettledFailure = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SignedImage
        endpoint={ENDPOINT}
        alt="Missing diagram"
        failureLabel="Image preview failed."
        retryLabel="Retry"
        onSettledFailure={onSettledFailure}
      />,
    );

    await screen.findByText("Image preview failed.");
    await waitFor(() => expect(onSettledFailure).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSettledFailure).toHaveBeenCalledTimes(2));
  });

  it("starts a new settled-failure callback cycle when the endpoint changes", async () => {
    const onSettledFailure = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <SignedImage endpoint="/api/images/first/signed-url" alt="First" onSettledFailure={onSettledFailure} />,
    );
    await waitFor(() => expect(onSettledFailure).toHaveBeenCalledTimes(1));

    rerender(<SignedImage endpoint="/api/images/second/signed-url" alt="Second" onSettledFailure={onSettledFailure} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSettledFailure).toHaveBeenCalledTimes(2));
  });

  it("honours Retry-After before automatically retrying a rate limit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
        json: async () => ({ error: "rate limited" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: "/demo/rate-recovered.png" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<SignedImage endpoint={ENDPOINT} alt="Rate recovered diagram" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const img = screen.getByRole("img", { name: "Rate recovered diagram" });
    expect(img.getAttribute("src")?.endsWith("/demo/rate-recovered.png")).toBe(true);
  });

  it("automatically refreshes the signed URL when the image download fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: "/demo/expired.png" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: "/demo/refreshed.png" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<SignedImage endpoint={ENDPOINT} alt="Refreshed diagram" failureLabel="Image preview failed." />);

    const img = await screen.findByRole("img", { name: "Refreshed diagram" });
    fireEvent.error(img);

    await waitFor(
      () =>
        expect(screen.getByRole("img", { name: "Refreshed diagram" }).getAttribute("src")).toContain("refreshed.png"),
      { timeout: 2_000 },
    );
    expect(screen.queryByText("Image preview failed.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a retryable failure state, then recovers when retry succeeds", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SignedImage endpoint={ENDPOINT} alt="Airway diagram" failureLabel="Image preview failed." retryLabel="Retry" />,
    );

    // The initial request and both bounded automatic retries fail, then the
    // component settles on its polite manual-recovery action.
    expect(await screen.findByText("Image preview failed.", {}, { timeout: 3_000 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Retry: the next fetch resolves with a URL and the image recovers.
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: "/demo/airway.png" }) });
    await user.click(retry);

    const img = await screen.findByRole("img", { name: "Airway diagram" });
    // Private previews use unoptimized next/image, so src stays the direct URL
    // (jsdom may absolutize it) and must not be rewritten through `/_next/image`.
    const src = img.getAttribute("src") ?? "";
    expect(src.endsWith("/demo/airway.png")).toBe(true);
    expect(src).not.toContain("/_next/image");
    expect(screen.queryByText("Image preview failed.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("opens the fullscreen lightbox when a loaded zoomable image is activated, and closes on Escape", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: "/demo/airway.png" }) }),
    );

    render(<SignedImage endpoint={ENDPOINT} alt="Airway diagram" caption="Airway" zoomable />);

    const img = await screen.findByRole("img", { name: "Airway diagram" });
    // jsdom never fires a real load event; simulate decode so `loaded` flips true.
    fireEvent.load(img);

    const expand = await screen.findByRole("button", { name: "Expand image: Airway" });
    await user.click(expand);

    expect(await screen.findByTestId("image-lightbox")).toBeInTheDocument();
    const lightbox = screen.getByTestId("image-lightbox");
    expect(lightbox).toHaveAttribute("role", "dialog");
    expect(within(lightbox).getByRole("img", { name: "Airway diagram" })).toHaveAttribute("decoding", "async");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument());
  });

  it("loads immediately when priority is set, skipping IntersectionObserver deferral", async () => {
    const observe = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: "/demo/hero.png" }),
    });
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(() => ({
        observe,
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: () => [],
        root: null,
        rootMargin: "",
        thresholds: [],
      })) as unknown as typeof IntersectionObserver,
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SignedImage endpoint={ENDPOINT} alt="Hero figure" priority />);

    const img = await screen.findByRole("img", { name: "Hero figure" });
    expect(observe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    const src = img.getAttribute("src") ?? "";
    expect(src.endsWith("/demo/hero.png")).toBe(true);
    // Above-the-fold evidence competes with the page it is part of, so it says
    // so — the deferred case below says the opposite.
    expect(img).toHaveAttribute("fetchpriority", "high");
  });

  it("keeps native lazy loading for a deferred figure", async () => {
    // `decoding="async"` (next/image's default) governs when the decode blocks;
    // fetch priority governs whether this image contends with the page's own
    // above-the-fold work at all. A long secondary figure rail should not.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: "/demo/rail.png" }) }),
    );

    render(<SignedImage endpoint={ENDPOINT} alt="Rail crop" />);

    const img = await screen.findByRole("img", { name: "Rail crop" });
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("fetchpriority", "low");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("does not request a signed URL until its frame reaches the observer boundary", async () => {
    let observerCallback: IntersectionObserverCallback | null = null;
    const disconnect = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: "/demo/intersected.png" }),
    });
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe() {}
        unobserve() {}
        disconnect = disconnect;
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = "";
        thresholds = [];
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SignedImage endpoint={ENDPOINT} alt="Observed diagram" />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: "Observed diagram" })).not.toBeInTheDocument();

    act(() => {
      observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(await screen.findByRole("img", { name: "Observed diagram" })).toHaveAttribute("loading", "lazy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it("defers on the root margin its caller asked for, not only the shared default", async () => {
    // The rail passes a tighter margin than the default. With no cross-surface
    // request scheduler, that differential is what decides which surface's
    // signed URLs resolve first, so a dropped prop is a real regression rather
    // than a cosmetic one.
    const observed: IntersectionObserverInit[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(_callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
          observed.push(options);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    vi.stubGlobal("fetch", vi.fn());

    render(<SignedImage endpoint={ENDPOINT} alt="Rail crop" rootMargin="240px 0px" />);

    expect(observed.at(0)?.rootMargin).toBe("240px 0px");
  });

  it("uses a provided source aspect ratio instead of forcing every document crop into 4:3", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: "/demo/wide-table.png" }) }),
    );

    render(<SignedImage endpoint={ENDPOINT} alt="Wide table" aspectRatio={4.2} />);

    const img = await screen.findByRole("img", { name: "Wide table" });
    const frame = img.closest("div");
    expect(frame).toHaveStyle({ aspectRatio: "4.2" });
    expect(frame?.className).not.toContain("aspect-[4/3]");
  });

  it("does not append Storage transform query params onto issued signed URLs", async () => {
    const signedUrl = "https://example.supabase.co/storage/v1/object/sign/images/demo.png?token=abc";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: signedUrl }) }),
    );

    // Default className is max-h-52; a prior broken heuristic rewrote that into
    // width/height/resize query params on object/sign URLs (silent no-op / risk).
    render(<SignedImage endpoint={ENDPOINT} alt="Signed crop" />);

    const img = await screen.findByRole("img", { name: "Signed crop" });
    const src = img.getAttribute("src") ?? "";
    expect(src).toContain("/object/sign/");
    expect(src).not.toContain("width=");
    expect(src).not.toContain("height=");
    expect(src).not.toContain("resize=");
  });

  it("deduplicates automatic retry requests when two mounted instances share an endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "temporary" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: "/demo/shared-recovered.png" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <div>
        <SignedImage endpoint={ENDPOINT} alt="Shared diagram 1" />
        <SignedImage endpoint={ENDPOINT} alt="Shared diagram 2" />
      </div>,
    );

    const img1 = await screen.findByRole("img", { name: "Shared diagram 1" }, { timeout: 2_000 });
    const img2 = await screen.findByRole("img", { name: "Shared diagram 2" }, { timeout: 2_000 });

    expect(img1.getAttribute("src")?.endsWith("/demo/shared-recovered.png")).toBe(true);
    expect(img2.getAttribute("src")?.endsWith("/demo/shared-recovered.png")).toBe(true);
    // 1 initial failed request + 1 deduplicated retry request = exactly 2 fetches
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resets failure state and automatic retry count when endpoint changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "not found" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: "/demo/new-endpoint.png" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <SignedImage endpoint="/api/images/first/signed-url" alt="First diagram" failureLabel="First failed" />,
    );

    expect(await screen.findByText("First failed")).toBeInTheDocument();

    rerender(
      <SignedImage endpoint="/api/images/second/signed-url" alt="Second diagram" failureLabel="Second failed" />,
    );

    const img = await screen.findByRole("img", { name: "Second diagram" });
    expect(img.getAttribute("src")?.endsWith("/demo/new-endpoint.png")).toBe(true);
    expect(screen.queryByText("First failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Second failed")).not.toBeInTheDocument();
  });
});

describe("SignedImage expand affordance (jsdom)", () => {
  const stubUrl = (url = "/demo/wide-table.png") =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ url }) }));

  it("keeps the expand chip visible on pointers that cannot hover", async () => {
    stubUrl();
    render(<SignedImage endpoint={ENDPOINT} alt="Wide table" zoomable />);

    const img = await screen.findByRole("img", { name: "Wide table" });
    fireEvent.load(img);

    const trigger = await screen.findByRole("button", { name: /Expand image/ });
    const chip = trigger.querySelector("span");
    // Reveal-on-hover left this permanently invisible on a phone — the one cue
    // that a clipped clinical table opens full screen never appeared on the
    // devices that need it. jsdom cannot evaluate a media query, so the class
    // contract is the assertion; the paint is covered by the Chromium journey.
    expect(chip?.className).toContain("[@media(hover:none)]:opacity-100");
    // Hover-capable pointers keep the quiet original.
    expect(chip?.className).toContain("group-hover/signed-image:opacity-100");
  });

  it("adds a labelled full-screen control only when the caller opts in", async () => {
    stubUrl();
    const { unmount } = render(<SignedImage endpoint={ENDPOINT} alt="Wide table" zoomable />);
    fireEvent.load(await screen.findByRole("img", { name: "Wide table" }));
    // Default DOM is unchanged for every existing caller.
    expect(screen.queryByTestId("signed-image-expand")).toBeNull();
    unmount();

    stubUrl();
    render(<SignedImage endpoint={ENDPOINT} alt="Wide table" zoomable expandLabel="Open full screen" />);
    fireEvent.load(await screen.findByRole("img", { name: "Wide table" }));

    const expand = await screen.findByTestId("signed-image-expand");
    expect(expand).toHaveTextContent("Open full screen");
    expect(expand).toHaveAttribute("aria-haspopup", "dialog");
    expect(expand).not.toBeDisabled();
  });

  it("opens the same lightbox from the labelled control", async () => {
    const user = userEvent.setup();
    stubUrl();
    render(<SignedImage endpoint={ENDPOINT} alt="Wide table" zoomable expandLabel="Open full screen" />);
    fireEvent.load(await screen.findByRole("img", { name: "Wide table" }));

    expect(screen.queryByTestId("image-lightbox")).toBeNull();
    await user.click(await screen.findByTestId("signed-image-expand"));
    expect(await screen.findByTestId("image-lightbox")).toBeInTheDocument();
  });

  it("ignores expandLabel without zoomable, since there would be nothing to open", () => {
    stubUrl();
    render(<SignedImage endpoint={ENDPOINT} alt="Wide table" expandLabel="Open full screen" />);
    expect(screen.queryByTestId("signed-image-expand")).toBeNull();
  });
});
