/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/my-day";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { MotionEnter, markMotionEnter } from "@/components/motion/motion-enter";

// Rules only: the file's notes may name what it leaves alone.
const css = readFileSync(join(process.cwd(), "src/app/motion.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function withAnimation(name: string) {
  const real = window.getComputedStyle;
  return vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
    const style = real(element);
    return new Proxy(style, {
      get: (target, key) => (key === "animationName" ? name : Reflect.get(target, key)),
    });
  });
}

describe("motion.css", () => {
  it("only animates when motion is allowed", () => {
    // Every rule sits inside a motion media query: nothing runs under reduced motion by default.
    const outside = css
      .replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    expect(outside).not.toMatch(/animation:|transition:/);
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain('html:not([data-motion="reduced"])');
  });

  it("uses the design system's motion tokens and never names the composer", () => {
    expect(css).toMatch(/var\(--duration-quick\)/);
    expect(css).not.toMatch(/\d+ms/);
    expect(css).not.toMatch(/composer|global-search/);
  });
});

describe("markMotionEnter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("marks an element and clears the mark when the fade ends", () => {
    withAnimation("motion-enter-fade");
    const element = document.createElement("div");
    markMotionEnter([element]);
    expect(element.hasAttribute("data-motion-enter")).toBe(true);
    element.dispatchEvent(new Event("animationend"));
    expect(element.hasAttribute("data-motion-enter")).toBe(false);
  });

  it("leaves nothing behind under reduced motion", () => {
    withAnimation("none");
    const element = document.createElement("div");
    markMotionEnter([element]);
    expect(element.hasAttribute("data-motion-enter")).toBe(false);
  });
});

describe("MotionEnter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("fades a Work page's content, not its band, on a move between Work pages", () => {
    withAnimation("motion-enter-fade");
    document.body.innerHTML =
      '<div id="main-content"><div><section class="work-band"></section><main id="page"></main></div></div>';
    pathname = "/my-day";
    const view = render(<MotionEnter />);
    pathname = "/my-day/week";
    act(() => view.rerender(<MotionEnter />));
    expect(document.getElementById("page")?.hasAttribute("data-motion-enter")).toBe(true);
    expect(document.querySelector(".work-band")?.hasAttribute("data-motion-enter")).toBe(false);
  });

  it("leaves Clinical pages alone", () => {
    withAnimation("motion-enter-fade");
    document.body.innerHTML =
      '<div id="main-content"><div><section class="work-band"></section><main id="page"></main></div></div>';
    pathname = "/";
    const view = render(<MotionEnter />);
    pathname = "/dsm";
    act(() => view.rerender(<MotionEnter />));
    expect(document.getElementById("page")?.hasAttribute("data-motion-enter")).toBe(false);
  });
});
