# Aliquot

LIMS and electronic lab notebook for contract analytical labs. Read `README.md` for what it does and `GLOSSARY.md` for the words we use.

## Commands

- `npm run dev`: development copy on http://localhost:3001 with its own `data-dev/` folder. Never point development at `data/`.
- `npm run check`: syntax-check every JavaScript file.
- `npm test`: end-to-end tests against a real server on a throwaway database.

## Coding standards

- **Zero dependencies, no build step.** Node built-ins only (`http`, `crypto`, `node:sqlite`) on the server; plain ES modules in the browser. Don't add packages, bundlers or transpilers.
- **Match the house style.** 2-space indent, single quotes, semicolons, trailing commas in multi-line literals, arrow functions for small helpers, early returns over nesting. Keep lines readable; long `html` template lines are tolerated, long logic lines are not.
- **Comments are rare and say why.** A one-line `/** … */` above an exported function when its contract isn't obvious from the name. No comments that restate the code.
- **The server enforces every rule.** Permissions, workflow states and GxP controls live on the server; the browser only hides what the server would refuse. A screen-only check is a bug.
- **All writes go through `repo.insert` / `repo.update`** so the audit trail records them. Never write `INSERT`/`UPDATE` against an audited table by hand.
- **Signed records stay locked.** Anything a signature depends on is never edited or deleted; corrections are new records.
- **E-signatures re-ask for the password** with `verifySignature` then `applySignature` (`server/auth.js`), with a stated meaning.
- **Schema changes are a new entry in `MIGRATIONS`.** Never edit a migration that has already run.
- **Escape by default in the browser.** Build markup with the `html` tagged template from `public/js/core/html.js`; never concatenate user data into HTML.
- **One route module per area, one view module per screen.** Put new code next to the code it belongs with, not in a new shared helper, unless two areas genuinely need it.
- **Test through HTTP.** New behaviour gets an assertion in `test/*.test.js` against the running server, including the case that must be refused.

## Agent skills

### Issue tracker

GitHub Issues in `zhipengzhu1-dotcom/10-03-2026-Initial-Launch`, not this clone's `origin`; always pass `--repo`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
