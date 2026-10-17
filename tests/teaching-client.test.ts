/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client-error";
import {
  TeachingSignedOutError,
  teachingErrorMessage,
  teachingGet,
  teachingLoadFailure,
  teachingPost,
  teachingServiceUrl,
} from "@/lib/teaching/client";

import { apiError, json, serveFetch } from "./helpers/teaching-fixtures";

afterEach(() => vi.restoreAllMocks());

const say = (code: string) => teachingErrorMessage(new ApiClientError("raw", 400, code, false));

describe("teaching client", () => {
  it("reads fresh every time, posts JSON, and can keep a post alive past a page close", async () => {
    const fetchMock = serveFetch(() => json(200, { count: 2 }));
    await expect(teachingGet<{ count: number }>("/api/teaching?view=unlogged-count")).resolves.toEqual({ count: 2 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    await teachingPost("/api/teaching/services/s1", { action: "notice.read", noticeId: "n1" }, { keepalive: true });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", keepalive: true });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({ action: "notice.read", noticeId: "n1" });
  });

  it("turns 401 into signed out and keeps the server's code otherwise", async () => {
    serveFetch((url) => (url === "/a" ? json(401, {}) : apiError(410, "teaching_code_expired")));
    await expect(teachingGet("/a")).rejects.toBeInstanceOf(TeachingSignedOutError);
    const error = await teachingGet("/b").catch((cause: unknown) => cause);
    expect((error as ApiClientError).code).toBe("teaching_code_expired");
  });

  it("classifies load failures, and calls a failure offline only when the browser is", () => {
    expect(teachingLoadFailure(new TeachingSignedOutError(), true)).toBe("signed-out");
    expect(teachingLoadFailure(new TypeError("Failed to fetch"), false)).toBe("offline");
    expect(teachingLoadFailure(new ApiClientError("x", 503, "teaching_setup_pending", true), true)).toBe("setup");
    expect(teachingLoadFailure(new ApiClientError("x", 500, "teaching_unavailable", true), true)).toBe("error");
  });

  it("words every refusal in plain service language, with no code, exclamation, CME or verified", () => {
    for (const code of [
      "teaching_code_expired",
      "teaching_code_invalid",
      "teaching_code_other_team",
      "teaching_window_closed",
      "teaching_link_expired",
      "teaching_not_attended",
      "teaching_not_found",
      "teaching_access_denied",
      "teaching_role_denied",
      "teaching_team_unverified",
      "teaching_limit",
      "teaching_no_health_service",
      "cme_year_missing",
      "cme_year_closed",
    ]) {
      expect(say(code), code).not.toMatch(/teaching_|cme_|!|verified|CME|\bteam\b/);
      expect(say(code).length, code).toBeGreaterThan(10);
    }
    expect(say("teaching_window_closed")).toBe(
      "Check-in for this session has closed. You can still check in without code for 7 days.",
    );
    expect(say("teaching_role_denied")).toBe("That's for your service's organisers.");
    expect(say("too_many_rows")).toBe("Use a sheet with up to 2,000 rows.");
    expect(say("something_new")).toBe("The outcome could not be confirmed. Check your records before trying again.");
  });

  it("says offline in the offline module's words, and encodes service URLs", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(teachingErrorMessage(new TypeError("Failed to fetch"))).toBe("You're offline. Teaching needs a connection.");
    expect(teachingServiceUrl("s 1", { action: "members.read" })).toBe(
      "/api/teaching/services/s%201?action=members.read",
    );
  });
});
