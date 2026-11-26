import { parse } from "parse5";

function textContent(root) {
  const pending = [root];
  const parts = [];
  while (pending.length) {
    const node = pending.pop();
    if (node.nodeName === "#text") parts.push(node.value);
    if (node.tagName === "br") parts.push(" ");
    if (["script", "style", "template"].includes(node.tagName)) continue;
    for (const child of (node.childNodes || []).slice().reverse()) pending.push(child);
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function readArxivMetadata(html, id) {
  const pending = [parse(html)];
  let citationTitle = "";
  let pageTitle = "";
  let abstract = "";
  while (pending.length) {
    const node = pending.pop();
    const attrs = Object.fromEntries((node.attrs || []).map(({name, value}) => [name, value]));
    if (node.tagName === "meta" && attrs.name === "citation_title") citationTitle = attrs.content?.trim() || "";
    if (node.tagName === "title") pageTitle = textContent(node);
    if (node.tagName === "blockquote" && attrs.class?.split(/\s+/).includes("abstract")) {
      abstract = textContent(node).replace(/^abstract:\s*/i, "");
    }
    for (const child of (node.childNodes || []).slice().reverse()) pending.push(child);
  }
  return { title: citationTitle || pageTitle || `arXiv:${id}`, abstract };
}
