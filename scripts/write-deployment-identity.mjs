import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

export function buildDeploymentIdentity(env = process.env) {
  if (env.VERCEL !== "1") return null;
  const commitSha = String(env.VERCEL_GIT_COMMIT_SHA || "").trim().toLowerCase();
  const host = String(env.VERCEL_URL || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error("Vercel deployment requires a full Git commit SHA");
  }
  if (!/^[a-z0-9.-]+\.vercel\.app$/.test(host)) {
    throw new Error("Vercel deployment requires a deployment-specific vercel.app URL");
  }
  return { commitSha, deploymentUrl: `https://${host}` };
}

const isDirectExecution = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectExecution) {
  const identity = buildDeploymentIdentity();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = resolve(root, "backend/src/generated/deploymentIdentity.js");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `export default Object.freeze(${JSON.stringify(identity)});\n`);
  console.log(identity ? "[deployment-identity] Generated deployment identity." : "[deployment-identity] Local build has no hosted identity.");
}
