import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRuntimeOllamaBaseUrl } from "@/config/ollamaConfig";
import { useOllamaModels } from "@/hooks/useOllamaModels";

const service = vi.hoisted(() => ({
  checkOllamaHealth: vi.fn<() => Promise<boolean>>(),
  getAvailableModels: vi.fn<() => Promise<string[]>>(),
  pullModel: vi.fn(),
}));

vi.mock("@/lib/ai/ollamaService", () => service);

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useOllamaModels(), { wrapper }) };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubEnv("VITE_ENABLE_OLLAMA", "false");
  service.checkOllamaHealth.mockReset();
  service.getAvailableModels.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("useOllamaModels discovery", () => {
  it("reports disabled without probing Ollama until runtime opt-in", async () => {
    service.checkOllamaHealth.mockResolvedValue(false);
    const { result } = setup();

    expect(result.current.discoveryStatus).toBe("disabled");
    expect(service.checkOllamaHealth).not.toHaveBeenCalled();

    act(() => result.current.setOllamaEnabled(true));
    await waitFor(() => expect(service.checkOllamaHealth).toHaveBeenCalled());
    expect(result.current.ollamaEnabled).toBe(true);
    expect(window.localStorage.getItem("studypod.localInference.enabled")).toBe("true");
  });

  it("distinguishes a stopped service from a running service with no models", async () => {
    service.checkOllamaHealth.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    service.getAvailableModels.mockResolvedValue([]);
    window.localStorage.setItem("studypod.localInference.enabled", "true");
    const { result, rerender, client } = setup();

    await waitFor(() => expect(result.current.discoveryStatus).toBe("unavailable"));
    expect(result.current.discoveryMessage).toContain("Could not reach Ollama from this browser");

    await act(async () => {
      client.setQueryData(["ollama-health", true, "http://localhost:11434"], true);
      rerender();
    });
    await waitFor(() => expect(result.current.discoveryStatus).toBe("no-models"));
    expect(result.current.discoveryMessage).toContain("no models are installed");
  });

  it("picks up a saved endpoint and ignores a stale health result", async () => {
    let resolveOldHealth!: (healthy: boolean) => void;
    service.checkOllamaHealth
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldHealth = resolve; }))
      .mockResolvedValueOnce(true);
    service.getAvailableModels.mockResolvedValue(["new-endpoint-model"]);
    window.localStorage.setItem("studypod.localInference.enabled", "true");
    window.localStorage.setItem("studypod.localInference.baseUrl", "http://old-ollama:11434");
    const { result, rerender } = setup();

    await waitFor(() => expect(service.checkOllamaHealth).toHaveBeenCalledTimes(1));
    act(() => {
      setRuntimeOllamaBaseUrl("http://new-ollama:11434");
      rerender();
    });

    await waitFor(() => expect(result.current.ollamaBaseUrl).toBe("http://new-ollama:11434"));
    await waitFor(() => expect(result.current.installedModels).toEqual(["new-endpoint-model"]));
    await act(async () => { resolveOldHealth(true); });

    expect(result.current.ollamaBaseUrl).toBe("http://new-ollama:11434");
    expect(result.current.installedModels).toEqual(["new-endpoint-model"]);
  });

  it("rechecks health and rediscovers models after local inference is disabled and re-enabled", async () => {
    let resolveSecondHealth!: (healthy: boolean) => void;
    service.checkOllamaHealth
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondHealth = resolve; }));
    service.getAvailableModels
      .mockResolvedValueOnce(["stale-model"])
      .mockResolvedValueOnce(["qwen3.5:9b"]);
    window.localStorage.setItem("studypod.localInference.enabled", "true");
    const { result } = setup();

    await waitFor(() => expect(result.current.discoveryStatus).toBe("ready"));
    expect(result.current.installedModels).toEqual(["stale-model"]);

    act(() => result.current.setOllamaEnabled(false));
    expect(result.current.discoveryStatus).toBe("disabled");

    act(() => result.current.setOllamaEnabled(true));
    await waitFor(() => expect(service.checkOllamaHealth).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.discoveryStatus).toBe("checking"));
    expect(result.current.installedModels).toEqual([]);

    await act(async () => { resolveSecondHealth(true); });
    await waitFor(() => expect(result.current.discoveryStatus).toBe("ready"));
    expect(result.current.installedModels).toEqual(["qwen3.5:9b"]);
    expect(service.getAvailableModels).toHaveBeenCalledTimes(2);
  });
});
