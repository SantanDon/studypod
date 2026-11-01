import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncryptionSettings } from "@/components/encryption/EncryptionSettings";

vi.mock("@/components/encryption/SyncStatus", () => ({ SyncStatus: () => null }));
vi.mock("@/components/encryption/SelectiveSync", () => ({ SelectiveSync: () => null }));
vi.mock("@/components/encryption/DataExport", () => ({ DataExport: () => null }));
vi.mock("@/components/encryption/SecurityLogs", () => ({ SecurityLogs: () => null }));
vi.mock("@/components/encryption/MfaSettings", () => ({ MfaSettings: () => null }));
vi.mock("@/components/settings/DeveloperSettings", () => ({ DeveloperSettings: () => null }));
vi.mock("@/components/settings/ChatGPTSettings", () => ({ ChatGPTSettings: () => null }));
vi.mock("@/components/settings/LocalInferenceSettings", () => ({ LocalInferenceSettings: () => null }));
vi.mock("@/components/settings/CloudInferenceSettings", () => ({ CloudInferenceSettings: () => null }));
vi.mock("@/components/settings/PersonalProviderConnection", () => ({ PersonalProviderConnection: () => null }));

afterEach(cleanup);

describe("settings tabs on small screens", () => {
  it("keeps every tab visibly labeled and named while using a compact mobile grid", () => {
    render(<EncryptionSettings />);

    const tabs = ["Sync", "Security", "Selective", "Backup", "Logs", "Models", "Developer"];
    const list = screen.getByRole("tablist");
    expect(list.className).toContain("grid-cols-2");
    expect(list.className).toContain("h-auto");

    for (const label of tabs) {
      const tab = screen.getByRole("tab", { name: label });
      expect(tab.querySelector("span")?.textContent).toBe(label);
      expect(tab.querySelector("span")?.className).not.toContain("hidden");
    }
  });
});
