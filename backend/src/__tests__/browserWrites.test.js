import { describe, expect, it, vi } from "vitest";
import { protectBrowserWrites } from "../middleware/browserWrites.js";

const guard = protectBrowserWrites(["https://studio.example"], false);
function decision({ method = "POST", path = "/api/notebooks", cookies = { accessToken: "fixture" }, ...headers } = {}) {
  const next = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  guard({ method, path, cookies, protocol: "https", get: (key) => ({ host: "demo.example", ...headers })[key] }, res, next);
  return next.mock.calls.length ? 200 : res.status.mock.calls[0][0];
}

describe("browser write origin policy", () => {
  it.each([
    [{ origin: "https://demo.example" }, 200],
    [{ origin: "https://studio.example", "sec-fetch-site": "cross-site" }, 200],
    [{ referer: "https://demo.example/notebooks/1" }, 200],
    [{ "sec-fetch-site": "same-origin" }, 200],
    [{ "content-type": "application/json; charset=utf-8" }, 200],
    [{ "x-requested-with": "XMLHttpRequest" }, 200],
    [{ origin: "https://other.example" }, 403],
    [{ origin: "null", referer: "https://demo.example/" }, 403],
    [{ "sec-fetch-site": "same-site" }, 403],
    [{ "content-type": "application/x-www-form-urlencoded" }, 403],
    [{ cookies: {}, path: "/api/auth/signin", origin: "https://other.example" }, 403],
    [{ cookies: {}, path: "/api/auth/signout", origin: "https://other.example" }, 403],
    [{ cookies: {}, path: "/api/auth/signout", origin: "https://demo.example" }, 200],
    [{ cookies: {}, path: "/api/auth/pair/complete" }, 200],
    [{ cookies: {}, path: "/oauth/token" }, 200],
    [{ cookies: {}, path: "/mcp", authorization: "Bearer fixture" }, 200],
    [{ method: "GET" }, 200],
  ])("decides %j as %i", (request, status) => expect(decision(request)).toBe(status));
});
