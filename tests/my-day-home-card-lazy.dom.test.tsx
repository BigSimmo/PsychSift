/** @vitest-environment jsdom */

// The home's lazy My Day card mounts (and so reads) only for a signed-in reader.
// A local demo build ("unconfigured") must not mount it: the card hides demo
// data, so its reads would be wasted requests on every demo home visit.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "authenticated" }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/account-data-provider", () => ({ useOptionalAccountData: () => ({}) }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function MockedCard() {
      return <div data-testid="my-day-card-mounted" />;
    },
}));

import { LazyMyDayHomeCard } from "@/components/my-day/my-day-home-card-lazy";

afterEach(cleanup);

describe("LazyMyDayHomeCard", () => {
  it("mounts the card for a signed-in reader", () => {
    auth.status = "authenticated";
    const { queryByTestId } = render(<LazyMyDayHomeCard />);
    expect(queryByTestId("my-day-card-mounted")).not.toBeNull();
  });

  it.each(["unconfigured", "loading", "signed_out", "expired", "error"])(
    "does not mount the card when %s",
    (status) => {
      auth.status = status;
      const { queryByTestId } = render(<LazyMyDayHomeCard />);
      expect(queryByTestId("my-day-card-mounted")).toBeNull();
    },
  );
});
