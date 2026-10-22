import { describe, expect, it } from "vitest";

import { GOVERNED_SOURCE_HOSTS, safeCanonicalSourceUrl } from "@/lib/sources/source-url-policy";

describe("governed source URL query policy", () => {
  it.each([
    "https://www.health.gov.au/resource?language=en",
    "https://www.legislation.wa.gov.au/act?OpenElement",
    "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=clozapine&t=pi",
  ])("allows the current benign query form %s", (value) => {
    expect(safeCanonicalSourceUrl(value)).toBe(value);
  });

  it.each([
    "client_secret",
    "refresh_token",
    "session_token",
    "jwt",
    "access_key",
    "auth_token",
    "X-Amz-Credential",
    "X-Amz-Security-Token",
  ])("rejects the credential-shaped query key %s", (key) => {
    expect(safeCanonicalSourceUrl(`https://www.ranzcp.org/guidance?${key}=sensitive-value`)).toBeNull();
  });

  it.each([
    "https://www.ranzcp.org/guidance?view=summary",
    "https://www.ranzcp.org/guidance?next=https%3A%2F%2Fexample.invalid%2Fsigned%3Ftoken%3Dsecret",
    "https://www.health.gov.au/resource?language=english",
    "https://www.health.gov.au/resource?language=en&language=fr",
    "https://www.health.gov.au/resource?language=en&view=summary",
    "https://www.legislation.wa.gov.au/act?OpenElement=1",
    "https://www.legislation.wa.gov.au/act?OpenElement&view=summary",
    "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=clozapine&t=cmi",
    "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=clozapine&t=pi&t=pi",
    "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm=1&q=clozapine&t=pi",
    "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=https%3A%2F%2Fexample.invalid&t=pi",
    "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/pdf?OpenAgent&id=CP-0000-00000-0",
    "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/pdf",
    "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI",
  ])("rejects the non-allowlisted query shape %s", (value) => {
    expect(safeCanonicalSourceUrl(value)).toBeNull();
  });

  it("allows governed host meteor.aihw.gov.au and maintains the pinned host count", () => {
    expect(safeCanonicalSourceUrl("https://meteor.aihw.gov.au/content/807042")).toBe(
      "https://meteor.aihw.gov.au/content/807042",
    );
    expect(GOVERNED_SOURCE_HOSTS).toContain("meteor.aihw.gov.au");
    expect(GOVERNED_SOURCE_HOSTS.length).toBe(61);
  });
});
