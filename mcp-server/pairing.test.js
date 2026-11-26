import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("pairing authorizes identity without returning the credential to the agent", async (t) => {
  const demoKey = "spm_test_fixture";
  const api = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/auth/pair/complete") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const options = JSON.parse(Buffer.concat(chunks));
      res.writeHead(options.expiresInHours === 1 ? 201 : 400);
      res.end(JSON.stringify({ key: demoKey, expiresAt: "2030-01-01T00:00:00Z" }));
    } else if (req.url === "/api/auth/me" && req.headers.authorization === "Bearer " + demoKey) {
      res.end(JSON.stringify({ id: "test-account" }));
    } else {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "forbidden" }));
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => { api.closeAllConnections(); api.close(); });
  const client = new Client({ name: "connector-test", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./index.js", import.meta.url))],
    env: { STUDYPODLM_API_URL: "http://127.0.0.1:" + api.address().port, STUDYPODLM_API_KEY: "" },
  }));
  t.after(() => client.close());
  const unsigned = await client.callTool({ name: "list_notebooks", arguments: {} });
  assert.equal(unsigned.isError, true);
  assert.match(unsigned.content[0].text, /pair tool/);
  const invalidSource = await client.callTool({ name: "add_source_from_github",
    arguments: { notebookId: "test-book", repoUrl: "https://examplegithub.com/demo/book" } });
  assert.equal(invalidSource.isError, true);
  assert.match(invalidSource.content[0].text, /github.com repository/);
  const paired = await client.callTool({ name: "pair", arguments: { code: "123456" } });
  assert.equal(JSON.parse(paired.content[0].text).success, true);
  assert.ok(!JSON.stringify(paired).includes(demoKey));
  const identity = await client.callTool({ name: "whoami", arguments: {} });
  assert.equal(JSON.parse(identity.content[0].text).id, "test-account");
  const denied = await client.callTool({ name: "list_notebooks", arguments: {} });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /403/);
});
