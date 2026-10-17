---
id: 3
group: "shared"
dependencies: [2]
status: "pending"
created: 2026-10-17
skills:
  - typescript
  - google-drive-api
complexity_score: 5
execution_profile: "standard-implementation"
---
# Shared Package: Drive URL Parsing, Retry Policy, Drive Client, Handler Registry

## Objective
Add the non-database shared logic to `packages/shared`: a pure Drive URL parser, the single retry-policy authority, a service-account Drive client, and the document-type handler registry (PDF only).

## Skills Required
typescript, google-drive-api.

## Acceptance Criteria
- [ ] `parseDriveFileId(url: string): string | null` accepts `https://drive.google.com/file/d/<id>/view…`, `…/open?id=<id>`, `…/uc?id=<id>` (with or without extra query params) and returns the ID; rejects other hosts, malformed URLs, and missing IDs.
- [ ] Retry policy module exports `MAX_ATTEMPTS = 5` and a function that, given the attempt count just used (1–5) and `now`, returns `{ retryAt: Date }` with backoff 1, 2, 4, 8 minutes for attempts 1–4, or `{ giveUp: true }` after attempt 5.
- [ ] Drive client (official `googleapis` or `@googleapis/drive` + `google-auth-library`), authenticated from a key-file path argument with scope `https://www.googleapis.com/auth/drive.readonly`, exposing `getMetadata(fileId) → { name, mimeType, size }` and `downloadToFile(fileId, destPath)`; uses `supportsAllDrives: true`.
- [ ] Handler registry: `DocumentHandler` interface `{ mimeType; prepare(filePath) → Promise<{ filePath; lpOptions: string[] }> }`, a `getHandler(mimeType)` lookup, a registered `application/pdf` pass-through handler, and an `UnsupportedDocumentTypeError` (permanent) plus a `PermanentJobError` base class that the worker can detect to skip retries.
- [ ] vitest tests cover each accepted URL shape plus rejections, and the full backoff sequence plus give-up after the 5th attempt. Verification: `pnpm --filter @print-me/shared test` exits 0, and `pnpm run build && pnpm run check && pnpm run format:check` exit 0.
- [ ] Everything is exported from the shared package's entry point.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Files under `packages/shared/src/` (e.g. `drive/url.ts`, `drive/client.ts`, `retry.ts`, `handlers/index.ts`, `errors.ts`); tests alongside (`*.test.ts`) as in screen-time.
- No real Google calls in tests; the Drive client is not unit-tested (thin wrapper over a third-party library).

## Input Dependencies
Task 2 workspace skeleton.

## Output Artifacts
Exports used by the worker (task 6) and web app (task 5, URL parser only).

## Implementation Notes
<details>
<summary>Guidance</summary>

- Test philosophy (copy for test work): "write a few tests, mostly integration". Test custom business logic, critical workflows, edge cases and error conditions; do **not** test third-party library behaviour, trivial getters/setters, static configuration, or obvious code. Combine related scenarios into a few test files.
- Follow PRE_TASK_EXECUTION TDD: write a failing URL-parser test first, then implement.
- URL parser: use `new URL()` inside try/catch; require host `drive.google.com` (also accept `docs.google.com/file/d/…` only if trivial — not required). IDs match `[A-Za-z0-9_-]{10,}`.
- Retry: `computeRetry(attemptsUsed, now)`; `attemptsUsed >= MAX_ATTEMPTS` → give up; delay = `2 ** (attemptsUsed - 1)` minutes.
- Drive client: `new google.auth.GoogleAuth({ keyFile, scopes })`, `drive.files.get({ fileId, fields: 'name,mimeType,size', supportsAllDrives: true })`; download with `alt: 'media'`, `responseType: 'stream'`, pipe to `fs.createWriteStream(destPath)` via `stream/promises.pipeline`. `size` comes back as a string; convert to number.
- Prefer `@googleapis/drive` + `google-auth-library` for a smaller install if it works cleanly; otherwise `googleapis`.
</details>
