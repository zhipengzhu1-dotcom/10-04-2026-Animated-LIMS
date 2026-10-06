# Aliquot

LIMS and electronic lab notebook for contract analytical labs. Read `README.md` for what it does and `GLOSSARY.md` for the words we use.

## Commands

- `npm run dev`: development copy on http://localhost:3001 with its own `data-dev/` folder. Never point development at `data/`.
- `npm run check`: syntax-check every JavaScript file and refuse hand-written writes that bypass the audit trail.
- `npm test`: end-to-end tests against a real server on a throwaway database.

## Coding standards

- **Zero dependencies, no build step.** Node built-ins only (`http`, `crypto`, `node:sqlite`) on the server; plain ES modules in the browser. Don't add packages, bundlers or transpilers. The one exception is a vendored browser library, copied as a file into `public/vendor/<name>/` with its licence and served by our own server (never from a CDN, because labs run Aliquot without internet access): today only three.js, loaded lazily by `public/js/core/helix.js`.
- **Match the house style.** 2-space indent, single quotes, semicolons, trailing commas in multi-line literals, arrow functions for small helpers, early returns over nesting. Keep lines readable; long `html` template lines are tolerated, long logic lines are not.
- **Comments are rare and say why.** A one-line `/** … */` above an exported function when its contract isn't obvious from the name. No comments that restate the code.
- **The server enforces every rule.** Permissions, workflow states and GxP controls live on the server; the browser only hides what the server would refuse. A view offers an action on a record when that record's `can` flag says so; `can(permission)` in the browser is for actions with no record yet. A status, ownership or Investigation check written in a view is a screen-only check, and a screen-only check is a bug.
- **Every record's rules live once, in its rules table.** Each record people act on has an exported `<RECORD>_RULES` table: one rule per action, taking the record and the person and returning nothing when allowed, or the refusal: `forbidden` / `bad`, or `notFound` where the person must not learn the record exists. A rule checks the permission first, so a person without it is always refused with `forbidden`; then the record's state and the person's part in it. Readiness checks the person can fix stay in the action. The action refuses through `guard(rule(...))` and the record's `can` is built with `flags(table, record, person)` (with `locks` where a screen shows why), all from `server/http.js`. A table lives beside its area's route module until importing it elsewhere would make a cycle; then it moves to a server module of its own, as `server/notebook.js`. `npm run check` refuses a misplaced table and a `can` written by hand; the coverage check in `test/agreement.test.js` fails until every rule is swept both offered and withheld.
- **Every list of work is a Queue, derived from its rule.** A list of the records a person is offered an action on (their Tests to review, the entries they may witness) is a Queue in its record's exported `<RECORD>_QUEUES` table, in the same module as `<RECORD>_RULES`: each entry names the `rule` it derives from and a `stage`, a function returning the records at that point of the work, narrowed by status only. Every surface, badge and work filter reads it through `queued(table, queue, person)` from `server/http.js` and only limits, sorts or combines it afterwards (oversight alone shows a Queue's `stage` unfiltered, because it is nobody's work); never write the list as SQL that restates the rule, and never pair it with a permission check (a person without the permission gets an empty Queue). See `docs/adr/0001-queues-derived-from-rules.md`. `npm run check` refuses a Queue table outside its rules table's module; the coverage check fails until every Queue names a rule its table has and is swept both listing and not listing a record, so give a new Queue its surfaces in `SURFACES` and its badges in `BADGES`.
- **All writes go through `repo.insert` / `repo.update`** so the audit trail records them. Never write `INSERT`/`UPDATE` against an audited table by hand.
- **Signed records stay locked.** Anything a signature depends on is never edited or deleted; corrections are new records.
- **E-signatures re-ask for the password** with `verifySignature` then `applySignature` (`server/auth.js`), with a stated meaning.
- **Schema changes are a new entry in `MIGRATIONS`.** Never edit a migration that has already run.
- **Escape by default in the browser.** Build markup with the `html` tagged template from `public/js/core/html.js`; never concatenate user data into HTML.
- **One route module per area, one view module per screen.** Put new code next to the code it belongs with, not in a new shared helper, unless two areas genuinely need it.
- **Test through HTTP.** New behaviour gets an assertion in `test/*.test.js` against the running server, including the case that must be refused.

## Agent skills

### Issue tracker

GitHub Issues in `zhipengzhu1-dotcom/10-04-2026-Animated-LIMS`, this clone's `origin`; always pass `--repo`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
