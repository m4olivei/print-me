---
id: 2
group: "scaffold"
dependencies: []
status: "completed"
created: 2026-10-17
skills:
  - pnpm-workspaces
  - typescript
complexity_score: 3
execution_profile: "standard-implementation"
---
# Monorepo Scaffold and Tooling

## Objective
Create the pnpm workspace skeleton (`apps/web`, `apps/worker`, `packages/shared`) with TypeScript, Prettier and `.gitignore`, following the `m4olivei/screen-time` conventions, so later tasks only add source code.

## Skills Required
pnpm-workspaces, typescript.

## Acceptance Criteria
- [x] Root `package.json` (private, `packageManager: "pnpm@11.20.0"`) with `build`, `check`, `format`, `format:check` scripts that fan out to the workspace packages.
- [x] `pnpm-workspace.yaml` covering `packages/*` and `apps/*`, with `allowBuilds` (screen-time style) for `better-sqlite3` and `esbuild`.
- [x] `tsconfig.base.json`; each package has its own `tsconfig.json` extending it, plus a `package.json` (`@print-me/web`, `@print-me/worker`, `@print-me/shared`) with `build` (tsc → `dist/`) and `check` (`tsc --noEmit`) scripts; apps also have `dev`/`start` via `tsx`; shared has `test` (vitest).
- [x] Each package has a minimal `src/index.ts` placeholder so build/check pass.
- [x] `.prettierrc` (tabs, single quotes, no trailing commas, `printWidth` 100, no Svelte/Tailwind plugins) and `.prettierignore` (excludes `.ai/`, `.claude/`, `apm_modules/`, `apm.lock.yaml`, `pnpm-lock.yaml`, `dist`, `infra/**/.terraform`).
- [x] Root `.gitignore` keeps the existing `apm_modules/` entry and adds: `.env*` except `!.env.example`, `node_modules`, `dist`, `/data/`, OpenTofu `*.tfstate*`, `*.tfvars` (but not `*.tfvars.example`), `.terraform/`, service-user dotfiles in the checkout root (e.g. `/.cache/`, `/.npm/`, `/.local/`), and a service-account key pattern (e.g. `*service-account*.json`, `gcp-key*.json`).
- [x] Verification: `pnpm install && pnpm run build && pnpm run check && pnpm run format:check` all exit 0; `git check-ignore apps/web/.env apps/worker/.env infra/cloudflare/terraform.tfvars infra/cloudflare/terraform.tfstate` prints all four paths.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Node 24 (installed), pnpm 11.20.0 via corepack (`corepack enable` or `corepack pnpm`), TypeScript, Prettier, vitest, tsx.
- ESM or CJS: follow screen-time. TypeORM decorators need `experimentalDecorators` and `emitDecoratorMetadata` in the tsconfig of packages that declare entities (put them in the base config).

## Input Dependencies
None.

## Output Artifacts
Workspace skeleton consumed by tasks 3–8.

## Implementation Notes
<details>
<summary>Guidance</summary>

1. Look at the reference repo first: `gh repo clone m4olivei/screen-time <scratchpad>/screen-time` (public), read its root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.prettierrc`, `.prettierignore`, `.gitignore`, and `packages/shared/package.json`/`apps/worker/package.json`. Copy conventions; drop Svelte/Tailwind/SvelteKit specifics.
2. If `pnpm` is not on PATH, use `corepack enable --install-directory ~/.local/bin` or `npx -y corepack pnpm …`; do not change the pinned version.
3. Do not add runtime dependencies (fastify, typeorm, etc.) here; those belong to tasks 3–6. Dev deps at root: `typescript`, `prettier`, `tsx`; `vitest` in shared.
4. The shared package must be importable by the apps as `@print-me/shared` via `workspace:*`; make its `main`/`exports`/`types` point at the built `dist` (or follow screen-time if it uses source).
5. Commit `pnpm-lock.yaml`.
6. No tests are warranted for scaffolding (static configuration).
</details>
