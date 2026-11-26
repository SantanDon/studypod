# StudyPod Security Audit

## CodeQL review, November 26, 2026

GitHub reported six open alerts for the [reviewed revision](https://github.com/SantanDon/studypod/commit/b199f16b92796a6eee15c6c2bc0b3afd92a9efc7) on the hosted-audio review branch. The table records the affected paths, controls exercised locally, and limits of those checks. All six alerts remained open at that revision.

| Alert and location | Control and regression coverage | Remaining exposure or assumption |
|---|---|---|
| [28](https://github.com/SantanDon/studypod/security/code-scanning/28) · resource exhaustion · `personalProviderService.js` | The personal provider has a fixed base URL. Its deadline defaults to 30 seconds and is bounded to 1–60 seconds. Cancellation stays active while reading the reply. [Deadline tests](../backend/src/__tests__/providerDeadlineBounds.test.js) | Concurrent requests can each consume their own allowance. |
| [29](https://github.com/SantanDon/studypod/security/code-scanning/29) · resource exhaustion · `titanProvider.js` | Retries, waits and response reads share a maximum 55-second dispatch budget. The JSON reader limits decoded responses to 2 MiB and bounds error reads. [Deadline tests](../backend/src/__tests__/providerDeadlineBounds.test.js) · [Response tests](../backend/src/__tests__/providerResponse.test.js) | The per-dispatch bounds do not measure deployment-wide memory use or provider capacity under load. |
| [87](https://github.com/SantanDon/studypod/security/code-scanning/87) · request forgery · `extractionService.js` | The importer accepts public HTTPS on port 443, rejects credentials and nonpublic addresses, checks all DNS answers, and pins the approved addresses for the connection. Each redirect is revalidated. The importer limits redirects to four and decoded content to 8 MiB. Its deadline includes DNS resolution. [URL checks](../backend/src/__tests__/externalUrlSafety.test.js) · [Destination tests](../backend/src/__tests__/extractionProviderDestinations.test.js) | An OS resolver operation can finish after the application stops waiting. Hosting egress and proxy configuration require independent verification. |
| [88](https://github.com/SantanDon/studypod/security/code-scanning/88) · missing token validation · `server.js` | The browser-write guard runs after cookie parsing and before protected routes. For cookie-backed writes and session changes it checks Origin or Referer, then Fetch Metadata. When browser origin signals are absent it requires JSON or the XHR header. [Browser-write tests](../backend/src/__tests__/browserWrites.test.js) | This relies on correct trusted origins, proxy settings, browser preflight enforcement and read-only safe HTTP methods. |
| [89](https://github.com/SantanDon/studypod/security/code-scanning/89) · missing token validation · `authRoutes.test.js` | The loopback auth test server installs the browser-write guard before the auth router. [Auth route tests](../backend/src/__tests__/authRoutes.test.js) | This test harness does not exercise the production reverse proxy. |
| [90](https://github.com/SantanDon/studypod/security/code-scanning/90) · missing token validation · `documentAgentCompatibility.test.js` | The loopback document test server installs the same guard. Its cases exercise scoped agent access through the document routes. [Document access tests](../backend/src/__tests__/documentAgentCompatibility.test.js) | These agent cases cover the tested scopes and routes. Browser-origin coverage lives in the separate browser-write suite. |

When the provider budgets, importer, middleware order, trusted origins or proxy settings change, rerun the linked suites and check the [branch alert list](https://github.com/SantanDon/studypod/security/code-scanning?query=is%3Aopen+branch%3Acodex%2Fhosted-audio-review-20261126) against the new revision. Record changes in alert status separately from passing regression tests.

## August 2026 release record

**Historical assessment date:** 2026-08-03
**Release:** Agent Missions, MCP/OAuth, grounded study workflows, document workspace, podcast hardening, and Audiobook Studio v2
**Scope:** `backend/`, `src/`, `api/`, `mcp-server/`, deployment configuration, and production dependencies

## Release posture

This release passed the complete automated, browser, API, storage, and deployment gates documented below. No API keys, tokens, environment files, databases, generated uploads, audiobook media, or QA artifacts are included in the release commit or Vercel upload.

### Resolved and hardened

| Area | Current state |
|---|---|
| Authentication | Passwords/passphrases are bcrypt-hashed server-side. Access and refresh credentials are issued through HttpOnly cookies or scoped API-key authentication. Production refuses to boot when `JWT_SECRET` is missing or shorter than 32 characters. |
| Account recovery | The insecure browser-local password-reset mock was removed. Recovery now uses the server-backed 24-word recovery flow and invalidates prior session state when the passphrase changes. |
| Removed attack surface | The obsolete admin migration route, legacy ChatGPT proxy/provider route, key-check scripts, debug research service, forensic PDF script, and obsolete video-key pool were removed. |
| Agent access | Pairing codes expire, persistent agent keys are hashed at rest, and every agent operation enforces scopes and notebook ownership. Cross-account mission access returns `404`. |
| Agent Missions | Goals and note counts are bounded. Mission claims are atomic, interrupted runs become recoverable, source and note text is treated as untrusted evidence, and completed reports include a verified evidence audit. |
| ChatGPT connector | StudyPod exposes OAuth discovery, dynamic client registration, PKCE, rotating refresh credentials, explicit consent, scoped MCP tools, and notebook ownership checks. Provider credentials are not sent to the browser. |
| External URL ingestion | Web extraction requires authentication and `sources:write`; only public HTTPS destinations are accepted. DNS and private/link-local/loopback address protections are centralized in `externalUrlSafety.js`. |
| Request hardening | Helmet, CSP, CORS allowlisting, bounded JSON/form bodies, cookie parsing, normalized request keys, route-level authentication, and production rate limiting are enabled. |
| Database access | User-facing data operations use parameterized Drizzle/libSQL queries. Notebook, source, note, mission, task, document, and audio metadata operations verify ownership. |
| Audiobook media | Source filenames and generated media filenames are kept distinct; media paths require safe basenames and ownership. Render manifests, chapter media, progress, and bookmarks are isolated per owner. |
| Serverless audio behavior | Vercel returns a clear local-beta capability response rather than starting non-durable local render workers or exposing broken generation controls. |
| Secret hygiene | `.env*`, `.vercel`, `.ai-bridge`, uploads, databases, local model caches, and generated media are ignored. The release secret-pattern scan and Git whitespace checks passed. |

## Current authentication surfaces

- **Human accounts:** server-side signup/sign-in, bcrypt verification, access/refresh credentials, optional TOTP MFA, and 24-word recovery.
- **Guest sessions:** explicitly identified guest tokens with restricted behavior.
- **Agent API keys:** human-sponsored pairing or Developer Settings, hashed storage, bounded scopes, and per-notebook ownership enforcement.
- **MCP/OAuth:** authorization-code flow with PKCE, consent records, short-lived access credentials, rotating refresh credentials, and scope checks on every tool.

## Known limitations and follow-up hardening

| ID | Limitation | Current mitigation / next step |
|---|---|---|
| **S1** | API and per-key rate-limit stores are process-local, so counters are not shared across serverless instances. | Route authentication and ownership still apply. Move production limiters to a shared Upstash/Vercel KV store before materially increasing public traffic. |
| **S2** | The browser ML/audio stack currently needs a permissive script policy (`unsafe-inline` / `unsafe-eval`) for compatibility. | All scripts remain same-origin except explicitly listed providers. Replace broad directives with nonces plus `wasm-unsafe-eval` after confirming Kokoro/ONNX compatibility. |
| **S3** | Locally received agent-upload files can exist as plaintext before the browser completes its encryption/import flow. | Uploads are excluded from Git and deployment. Add envelope encryption at write time for shared or multi-user server installations. |
| **S4** | Full audiobook rendering is local-runtime only; Vercel cannot provide durable filesystem jobs. | Production clearly disables creation and labels it Local Beta. Connect object storage plus a durable queue before enabling cloud rendering. |
| **S5** | The deployment still supports the legacy server-only `VITE_GROQ_API_KEY` alias during migration. | Frontend source has no references and the value is never bundled. Rename it to `GROQ_API_KEY` in Vercel, then remove the fallback in a later release. |
| **S6** | npm reports React Router advisory `GHSA-qwww-vcr4-c8h2`. | StudyPod is a Vite `BrowserRouter` SPA and uses none of the affected RSC, loader, action, or server-router APIs. `scripts/audit-production.mjs` fails if any other production advisory appears or if an affected API is introduced. |

## Release validation evidence

- **Automated:** 77 test files and 591 tests passed.
- **Static:** TypeScript passed with zero errors; ESLint passed with zero errors.
- **Build:** production Vite build and exact Vercel Node 22 package build passed.
- **Budgets:** initial app 446.4/600 KB, notebook 1636.9/1850 KB, Studio 439.2/500 KB.
- **Dependencies:** backend production audit reports zero vulnerabilities; frontend production audit passes only the narrowly unreachable React Router exception above.
- **Real-source browser regression:** eight sources (PDF, DOCX, text, pasted evidence, website, and YouTube) were ingested; eight grounded chats, citations, note/task persistence, source viewing, document revisions, version history, and DOCX/PDF exports passed.
- **Agent Mission browser/API regression:** grounded cited report, durable note, reload persistence, 390 px mobile layout, cross-account denial, and persisted no-source failure passed with zero browser console or page errors.
- **Long-book regression:** a 398-page PDF was structured into real chapters, progressively narrated, interrupted mid-render, resumed with cached chapters, and verified after another restart with progress and bookmarks intact.

## Maintenance protocol

1. Keep this audit synchronized with every authentication, connector, ingestion, storage, or deployment change.
2. Require automated tests, typecheck, lint, build, bundle budgets, both production audits, and at least one real browser/API journey before production promotion.
3. Run a secret-pattern scan and `git diff --check` before every release commit.
4. Never commit environment files, generated uploads, databases, local model caches, audio outputs, Vercel state, or QA artifacts.
5. Rotate signing secrets and provider credentials after any suspected exposure and remove compatibility aliases once migrations are complete.

## Earlier review of PDF attachment names

The earlier review of CodeQL alert #84 traced separator normalization in PDF.js 5.4.394 to embedded attachment filenames. At that review the checked-in worker matched the installed upstream worker byte for byte (SHA-256 `cee92175925a2a7a43f3450a99e583fcbecc2685509e1dc270a03a186861592f`). StudyPod's extractor read page text. The review found no frontend or backend call to `getAttachments()` and no filesystem write from the filename. Alert #84 was absent from the six open alerts at the November revision above. Revisit this path before adding PDF attachment downloads or server-side attachment extraction.
