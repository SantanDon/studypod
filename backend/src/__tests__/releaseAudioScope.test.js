import { describe, expect, it, vi } from "vitest";
import { requireScope } from "../middleware/auth.js";

// Real middleware (no mocks): documents the actual sources:write gating the
// cancel route relies on. Scope enforcement applies to api_key callers;
// session/JWT callers pass through to the ownership checks in the route.
const run = (middleware, user) =>
  new Promise((resolve) => {
    const req = { user };
    const res = {
      status: vi.fn(() => res),
      json: vi.fn((body) => {
        resolve({ allowed: false, body });
        return res;
      }),
    };
    middleware(req, res, () => resolve({ allowed: true }));
  });

describe("release audiobook sources:write gating (real middleware)", () => {
  it("denies an api_key caller without sources:write", async () => {
    const result = await run(requireScope("sources:write"), {
      authMethod: "api_key",
      scopes: ["sources:read"],
    });
    expect(result.allowed).toBe(false);
    expect(result.body.error).toMatch(/lacks required scope/);
  });

  it("allows an api_key caller holding sources:write", async () => {
    const result = await run(requireScope("sources:write"), {
      authMethod: "api_key",
      scopes: ["sources:read", "sources:write"],
    });
    expect(result.allowed).toBe(true);
  });

  it("passes session callers through to route ownership checks", async () => {
    const result = await run(requireScope("sources:write"), {
      authMethod: "jwt",
      userId: "owner-a",
    });
    expect(result.allowed).toBe(true);
  });
});
