import test from "node:test";
import assert from "node:assert/strict";
import { readArxivMetadata } from "./arxiv.js";

test("extracts citation title and plain abstract with inline math and entities", () => {
  const html = "<title>[1234] Sample</title><meta content='Study A &amp; B' name='citation_title'>" +
    "<blockquote class='other abstract'><span>Abstract:</span> A &lt; B<br>with <i>math</i>." +
    "<script>ignored</script></blockquote>";
  assert.deepEqual(readArxivMetadata(html, "1234"), { title: "Study A & B", abstract: "A < B with math." });
});

test("uses document title and then paper id as fallbacks", () => {
  assert.equal(readArxivMetadata("<title>Study</title>", "1234").title, "Study");
  assert.deepEqual(readArxivMetadata("", "1234"), { title: "arXiv:1234", abstract: "" });
});
