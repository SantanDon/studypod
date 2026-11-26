import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("existing API-key clients can discover, list and write through the public MCP entry point", async (t) => {
  const notebooks = [{ id: "book-1", title: "Science" }];
  const apiKey = "spm_connector_fixture";
  const requests = [];
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({ method: request.method, path: request.url, body });
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== "Bearer " + apiKey) {
      response.writeHead(401).end("{}");
    } else if (request.method === "GET" && request.url === "/api/notebooks") {
      response.end(JSON.stringify(notebooks));
    } else if (request.method === "POST" && request.url === "/api/notebooks/book-1/notes") {
      response.writeHead(201).end(JSON.stringify({ id: "note-1", notebook_id: "book-1", content: JSON.parse(body).content }));
    } else {
      response.writeHead(404).end("{}");
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => { api.closeAllConnections(); api.close(); });

  const client = new Client({ name: "existing-notebook-client", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./index.js", import.meta.url))],
    env: { STUDYPODLM_API_URL: "http://127.0.0.1:" + api.address().port, STUDYPODLM_API_KEY: apiKey },
  }));

  const { tools } = await client.listTools();
  for (const [name, required] of [["list_notebooks", []], ["create_note", ["content", "notebook_id"]]]) {
    const schema = tools.find(tool => tool.name === name)?.inputSchema;
    assert.ok(schema, name + " must remain discoverable");
    assert.deepEqual([...(schema.required ?? [])].sort(), required);
    for (const field of required) assert.equal(schema.properties[field].type, "string");
  }

  const list = await client.callTool({ name: "list_notebooks", arguments: {} });
  assert.ok(!list.isError);
  assert.equal(list.content[0].type, "text");
  assert.deepEqual(JSON.parse(list.content[0].text), notebooks);

  const note = await client.callTool({ name: "create_note", arguments: { notebook_id: notebooks[0].id, content: "Study leaves." } });
  assert.ok(!note.isError);
  assert.equal(note.content[0].type, "text");
  assert.deepEqual(JSON.parse(note.content[0].text), { id: "note-1", notebook_id: "book-1", content: "Study leaves." });
  assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
    ["GET", "/api/notebooks"], ["POST", "/api/notebooks/book-1/notes"],
  ]);
  assert.deepEqual(JSON.parse(requests[1].body), { content: "Study leaves." });
});
