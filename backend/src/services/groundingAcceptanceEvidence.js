import { randomUUID, createHash } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const bounded = (value, limit) => {
  const text = typeof value === "string" ? value : "";
  return { text: text.slice(0, limit), length: text.length, sha256: digest(text), truncated: text.length > limit };
};

// Private synthetic acceptance diagnostics only. Never log these payloads or
// attach them to API errors. Any collection failure leaves product behavior intact.
export function createGroundingAcceptanceRecorder(env = process.env) {
  const enabled = env.STUDYPOD_GROUNDING_CAPTURE === "1" &&
    env.STUDYPOD_ACCEPTANCE_SYNTHETIC === "1" && env.STUDYPOD_FULL_ISOLATED === "1" &&
    env.NODE_ENV !== "production" && !env.VERCEL && !env.TURSO_AUTH_TOKEN &&
    isAbsolute(env.STUDYPOD_GROUNDING_RUN_DIR || "");
  const configuration = { runDir: env.STUDYPOD_GROUNDING_RUN_DIR, database: env.TURSO_DATABASE_URL };
  const auditId = randomUUID();
  let attempts = 0;
  return async (candidate) => {
    if (!enabled || attempts >= 2) return false;
    attempts += 1;
    try {
      const url = new URL(configuration.database);
      if (url.protocol !== "file:" || url.hostname) return false;
      const database = await realpath(fileURLToPath(url));
      const runDir = await realpath(configuration.runDir);
      if (basename(database) !== "acceptance.db" || dirname(database) !== runDir || !(await stat(database)).isFile()) return false;
      const output = join(runDir, "grounding-candidates.private");
      await mkdir(output, { recursive: true, mode: 0o700 });
      if (await realpath(output) !== output) return false;
      const citations = (items) => (items || []).slice(0, 24).map((item) => ({
        citation_id: Number(item.citation_id), excerpt: bounded(item.excerpt, 240),
      }));
      const payload = {
        schema: 1, syntheticAcceptanceOnly: true, auditId,
        attempt: candidate.attempt === "repair" ? "repair" : "initial",
        model: bounded(candidate.model, 160), tokensUsed: Number(candidate.tokensUsed) || 0,
        failure: "GROUNDING_UNAVAILABLE", question: bounded(candidate.question, 4000),
        rawAnswer: bounded(candidate.rawAnswer, 16000), notebookContext: bounded(candidate.notebookContext, 64000),
        // Audit-local numbers map citations to the supplied source content without
        // persisting notebook/account/source IDs, URLs, titles, or history.
        sources: (candidate.sourceRefs || []).slice(0, 24).map((ref) => {
          const content = candidate.contextSources?.find((source) => source.id === ref.id)?.content || "";
          return { index: ref.index, contentLength: content.length, contentSha256: digest(content) };
        }),
        parsedCitations: citations(candidate.trace?.parsedCitations),
        expectedCitations: citations(candidate.trace?.expectedCitations),
        validatedCitations: citations(candidate.trace?.validatedCitations),
        stage: "citation-claim-alignment",
      };
      await writeFile(join(output, `${auditId}-${attempts}.json`), JSON.stringify(payload, null, 2), { flag: "wx", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  };
}
