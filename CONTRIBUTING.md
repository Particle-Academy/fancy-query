# Contributing to @particle-academy/fancy-query

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Build and test

```bash
npm run build       # tsup
npm run dev         # tsup --watch
npm run lint        # tsc --noEmit && eslint .
npm test            # vitest run
```

- Tests live in `tests/`.
- Entries: `.` (provider, hooks, client), `./inertia` (`useInertiaHydration`,
  the only code that touches the optional `@inertiajs/react` peer) and
  `./socket` (`createSocketEcho`, which imports no React, Inertia or query
  runtime).
- TanStack Query, `@inertiajs/react` and React are peers; nothing is bundled.

## Changelog

Update `CHANGELOG.md` (`## [Unreleased]`) in the same commit as the change.
