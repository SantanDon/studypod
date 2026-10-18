import assert from "node:assert/strict";
import test from "node:test";
import { buildDeploymentIdentity } from "./write-deployment-identity.mjs";

const sha = "a".repeat(40);
const host = "studypod-git-release-abc123-team.vercel.app";

test("local build contains no hosted identity", () => {
  assert.equal(buildDeploymentIdentity({ VERCEL: "0", VERCEL_GIT_COMMIT_SHA: sha, VERCEL_URL: host }), null);
});

test("hosted build accepts only a full commit and deployment host", () => {
  assert.deepEqual(buildDeploymentIdentity({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: sha, VERCEL_URL: host }),
    { commitSha: sha, deploymentUrl: `https://${host}` });
  assert.throws(() => buildDeploymentIdentity({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: sha.slice(0, 7), VERCEL_URL: host }));
  assert.throws(() => buildDeploymentIdentity({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: sha, VERCEL_URL: "production.example.com" }));
  assert.throws(() => buildDeploymentIdentity({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: sha, VERCEL_URL: "evil.vercel.app.attacker.com" }));
  assert.throws(() => buildDeploymentIdentity({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: sha }));
});
