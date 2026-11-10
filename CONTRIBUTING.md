# Contributing

## Setup

```bash
git clone https://github.com/Narcooo/inkos.git
cd inkos
pnpm install
pnpm build
pnpm test
```

Node ≥ 20, pnpm ≥ 9.

## Project Structure

```
packages/
  core/    # Agents, pipeline, state management, LLM providers
  cli/     # Commander.js commands (22 commands)
```

Monorepo managed with pnpm workspaces. `cli` depends on `core` via `workspace:*`.

## Development

```bash
pnpm dev          # Watch mode (both packages)
pnpm build        # Build once
pnpm test         # Run all tests
pnpm typecheck    # Type-check without emitting
```

## Fork 同步

在 `develop` 分支执行：

```bash
./scripts/sync-fork.mjs
```

脚本仅依赖 Node.js 和 Git，无需安装项目依赖。需要已配置 `origin`（自己的 fork）、`upstream`（原仓库），以及 `master`、`develop` 和对应的 `origin` 分支。
脚本先拉取两个远端，将 `master` 快进到 `upstream/master` 并推送到 fork，再将 `master` 合并到 `develop` 并推送，全程保留开发提交的历史。

执行前需提交或自行暂存工作区改动。`master` 或 `origin/master` 存在上游没有的提交、`develop` 与 `origin/develop` 无法快进同步时，脚本会停止，留待人工处理。
若合并上游时发生冲突，脚本停在 `develop`；解决冲突并提交后重新执行脚本，或用 `git merge --abort` 撤销这次合并。
推送失败时已完成的本地更新或远端推送会保留，处理失败原因后可重新执行。

## Commit Convention

```
<type>: <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Keep commits atomic — one logical change per commit. Split new files, interface changes, tests, and docs into separate commits when they're non-trivial.

## Pull Request Checklist

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes (all existing + new tests)
- [ ] `pnpm typecheck` passes
- [ ] New features have tests
- [ ] No unrelated formatting changes (keep diffs focused)
- [ ] Commit messages follow the convention above

## Code Style

- TypeScript, strict mode
- 2-space indentation
- Immutable patterns: `{ ...obj, key: value }` over mutation
- Functions < 50 lines, files < 800 lines
- Errors must surface, not be swallowed (`catch { }` without re-throw needs a comment)
- Publishable package manifests must use registry-installable internal versions, not `workspace:*`; `pnpm` links local packages through the workspace config during development.

## Adding a CLI Command

1. Create `packages/cli/src/commands/<name>.ts`
2. Export a `Command` instance
3. Register it in `packages/cli/src/index.ts`
4. Add `--json` output support
5. Support book-id auto-detection when only one book exists

## Adding a Genre

1. Create `packages/core/genres/<id>.md` with YAML frontmatter
2. Define: `chapterTypes`, `fatigueWords`, `numericalSystem`, `powerScaling`, `pacingRule`, `satisfactionTypes`, `auditDimensions`, `language`
3. Add genre body (prohibitions, language rules, narrative guidance)

## Testing

Tests live next to source in `__tests__/` directories. We use Vitest.

```bash
pnpm --filter @actalk/inkos-core test    # Core tests only
pnpm --filter @actalk/inkos test         # CLI tests only
```

For features touching the LLM pipeline, mock the LLM calls — don't make real API requests in tests.

## Questions?

Open an issue or check existing ones: https://github.com/Narcooo/inkos/issues
