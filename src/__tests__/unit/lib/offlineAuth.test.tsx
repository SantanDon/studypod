import { useContext } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/contexts/AuthContextInstance";
import { AuthProvider } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";

vi.mock("@/services/apiService", () => ({ ApiService: { getUser: vi.fn() } }));

function Status() {
  const auth = useContext(AuthContext)!;
  return <div>{auth.loading ? "loading" : auth.user?.id ?? "signed out"}</div>;
}

const guest = { id: "guest_abcdefghijkl", account_type: "guest" };

function seed(user: typeof guest, sessionUser = user, expiresAt = Date.now() + 60000) {
  localStorage.setItem("currentUser", JSON.stringify(user));
  localStorage.setItem("currentSession", JSON.stringify({
    user: sessionUser, expires_at: expiresAt, access_token: guest.id,
  }));
}

beforeEach(() => {
  vi.mocked(ApiService.getUser).mockRejectedValue(new Error("No active session"));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe("restoring browser sessions", () => {
  it("migrates existing signed-in sessions to cookie-only profile recovery", async () => {
    seed({ id: "old-cloud", account_type: "cloud" });
    vi.mocked(ApiService.getUser).mockResolvedValue({ user: {
      id: "verified", email: "demo@example.invalid", createdAt: "2026-01-01",
    } } as Awaited<ReturnType<typeof ApiService.getUser>>);
    render(<AuthProvider><Status /></AuthProvider>);
    await screen.findByText("verified");
    expect(localStorage.getItem("currentUser")).toBeNull();
    expect(localStorage.getItem("currentSession")).toBeNull();
  });

  it("keeps matching unexpired legacy guest sessions usable offline", async () => {
    seed(guest);
    render(<AuthProvider><Status /></AuthProvider>);
    await screen.findByText(guest.id);
  });

  it.each(["cloud", "mismatch", "expired", "corrupt"])("discards %s cache on a missing cookie profile", async (kind) => {
    if (kind === "cloud") seed({ id: "stale-cloud", account_type: "cloud" });
    if (kind === "mismatch") seed(guest, { ...guest, id: "different" });
    if (kind === "expired") seed(guest, guest, Date.now() - 1000);
    if (kind === "corrupt") localStorage.setItem("currentUser", "broken");
    render(<AuthProvider><Status /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("signed out")).toBeTruthy());
    expect(localStorage.getItem("currentUser")).toBeNull();
  });
});
