import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(), fetchSources: vi.fn(), updateNotebook: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { access_token: "test-session" } }) }));
vi.mock("@/services/apiService", () => ({ ApiService: { fetchSources: mocks.fetchSources, updateNotebook: mocks.updateNotebook } }));
vi.mock("@/config/localModelConfig", () => ({ isCompatibleLocalModelSelected: () => false }));
vi.mock("@/config/ollamaConfig", () => ({ isOllamaEnabled: () => false }));
vi.mock("@/lib/ai/ollamaService", () => ({ chatCompletion: mocks.generate, checkOllamaHealth: vi.fn() }));

it("persists the pasted source title and excerpt once when metadata generation is unavailable", async () => {
  mocks.generate.mockRejectedValue(Object.assign(new Error("Provider unavailable"), { status: 503 }));
  mocks.updateNotebook.mockResolvedValue({ id: "notebook" });
  const savedSource = {
    type: "text" as const,
    title: "Observatory visit",
    content: "The west observation tower opens two hours after sunset.",
  };
  const client = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(useNotebookGeneration, { wrapper });
  await act(async () => {
    await result.current.generateNotebookContentAsync({ notebookId: "notebook", filePath: "paste", sourceType: "text", savedSource });
  });
  expect(mocks.fetchSources).not.toHaveBeenCalled();
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(mocks.updateNotebook).toHaveBeenCalledOnce();
  expect(mocks.updateNotebook).toHaveBeenCalledWith("notebook", {
    title: savedSource.title, description: savedSource.content,
    example_questions: expect.arrayContaining([expect.stringContaining(savedSource.title)]),
    generation_status: "completed",
  }, "test-session");
  expect(mocks.toast).not.toHaveBeenCalled();
});
