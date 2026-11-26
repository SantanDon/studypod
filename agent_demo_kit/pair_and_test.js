// Exchange a human-generated PIN for a short-lived demo key.
const API_BASE = (process.env.STUDYPOD_API || "http://127.0.0.1:4000/api").replace(/\/+$/, "");
const [pin, option, notebookId, ...extraArgs] = process.argv.slice(2);

async function request(step, path, options) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`${step} failed. Check STUDYPOD_API and the server connection.`);
  }
  if (!response.ok) {
    throw new Error(`${step} failed (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${step} returned invalid JSON.`);
  }
}

async function main() {
  const invalidWriteOption =
    option !== undefined &&
    (option !== "--write-note" || !notebookId?.trim() || extraArgs.length > 0);
  if (!/^\d{6}$/.test(pin ?? "") || invalidWriteOption) {
    throw new Error(
      "Usage: node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN> [--write-note <NOTEBOOK-ID>]",
    );
  }

  const { key } = (await request("Pairing", "/auth/pair/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: pin,
      label: "DemoAgent",
      scopes: notebookId ? ["notebooks:read", "notes:create"] : ["notebooks:read"],
      notebookIds: notebookId ? [notebookId] : undefined,
      expiresInHours: 1,
    }),
  })) ?? {};
  if (typeof key !== "string" || !key.startsWith("spm_")) {
    throw new Error("Pairing returned no usable agent key.");
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const identity = await request("Identity verification", "/auth/me", { headers });
  if (!identity?.id) {
    throw new Error("Identity verification returned no user ID.");
  }

  const notebooks = await request("Notebook listing", "/notebooks", { headers });
  if (!Array.isArray(notebooks)) {
    throw new Error("Notebook listing returned an unexpected response.");
  }
  console.log(`Pairing and identity verified. Accessible notebooks: ${notebooks.length}.`);

  if (notebookId) {
    if (!notebooks.some((notebook) => notebook?.id === notebookId)) {
      throw new Error("The requested notebook is unavailable to the demo key.");
    }
    const note = await request(
      "Test note creation",
      `/notebooks/${encodeURIComponent(notebookId)}/notes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "StudyPod agent pairing test note." }),
      },
    );
    if (!note?.id) {
      throw new Error("Test note creation returned no note ID.");
    }
    console.log("Test note created in the requested notebook.");
  }
  console.log("Agent demo complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
