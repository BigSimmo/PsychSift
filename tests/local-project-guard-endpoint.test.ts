import { describe, expect, it } from "vitest";

import { isLocalProjectIdentityEndpointEnabled } from "../src/lib/local-project-guard";

const prod = { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("isLocalProjectIdentityEndpointEnabled", () => {
  it("answers a local next start addressed to loopback", () => {
    expect(isLocalProjectIdentityEndpointEnabled(req("http://localhost:3576/api/local-project-id"), prod)).toBe(true);
  });

  it.each(["0.0.0.0", "[::]"])("rejects a %s bind despite spoofed loopback Host and XFF", (hostname) => {
    const request = req(`http://${hostname}:3576/api/local-project-id`, {
      host: "localhost:3576",
      "x-forwarded-for": "::ffff:127.0.0.1",
    });
    expect(isLocalProjectIdentityEndpointEnabled(request, prod)).toBe(false);
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("accepts Next's loopback XFF %s on a loopback bind", (address) => {
    const request = req("http://127.0.0.1:3576/api/local-project-id", { "x-forwarded-for": address });
    expect(isLocalProjectIdentityEndpointEnabled(request, prod)).toBe(true);
  });

  it("404s a wildcard-bound server addressed by a non-loopback Host", () => {
    const request = req("http://0.0.0.0:3000/api/local-project-id", { host: "psychsift.example" });
    expect(isLocalProjectIdentityEndpointEnabled(request, prod)).toBe(false);
  });

  it("404s a wildcard-bound server with a non-loopback forwarding hop", () => {
    const request = req("http://0.0.0.0:3000/api/local-project-id", {
      host: "localhost:3000",
      "x-forwarded-for": "203.0.113.9",
    });
    expect(isLocalProjectIdentityEndpointEnabled(request, prod)).toBe(false);
  });

  it("404s on Railway even with a loopback Host header", () => {
    const env = { NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production" } as unknown as NodeJS.ProcessEnv;
    const request = req("http://0.0.0.0:8080/api/local-project-id", { host: "localhost" });
    expect(isLocalProjectIdentityEndpointEnabled(request, env)).toBe(false);
  });
});
