# Aliquot

LIMS and electronic lab notebook for contract analytical labs. Read `README.md` for what it does and `GLOSSARY.md` for the words we use.

## Commands

- `npm run dev`: development copy on http://localhost:3001 with its own `data-dev/` folder. Never point development at `data/`.
- `npm run check`: syntax-check every JavaScript file and refuse hand-written writes that bypass the audit trail and verify feature maps that name code that is gone.
- `npm test`: end-to-end tests against a real server on a throwaway database.
- Public demo down, Cloudflare error 1033, or publishing `main` to app/animated.nitrolims-demo.com: README "The public demo". It runs from a separate live clone, not this one.

## Coding standards

- **Zero dependencies, no build step.** Node built-ins only (`http`, `crypto`, `node:sqlite`) on the server; plain ES modules in the browser. Don't add packages, bundlers or transpilers. The one exception is a vendored browser library, copied as a file into `public/vendor/<name>/` with its licence and served by our own server (never from a CDN, because labs run Aliquot without internet access): today only three.js, loaded lazily by `public/js/core/helix.js`.
- **All writes go through `repo.insert` / `repo.update`** so the audit trail records them. Never write `INSERT`/`UPDATE` against an audited table by hand.
- **Signed records stay locked.** Anything a signature depends on is never edited or deleted; corrections are new records.
- **E-signatures re-ask for the password** with `verifySignature` then `applySignature` (`server/auth.js`), with a stated meaning.
- **Schema changes are a new entry in `MIGRATIONS`.** Never edit a migration that has already run.
- **Everything else a reviewer enforces is in `CODING_STANDARDS.md`.** Read its "Every record's rules" and "Every list of work" bullets before adding or changing an action, a Queue, a badge (its surfaces and badges are registered in `test/surfaces.js`) or a `can` flag, and "Escape by default" before writing browser markup.

## Agent skills

### Issue tracker

GitHub Issues in `zhipengzhu1-dotcom/10-04-2026-Animated-LIMS`, this clone's `origin`; always pass `--repo`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
