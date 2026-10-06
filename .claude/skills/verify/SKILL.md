---
name: verify
description: Launch a throwaway Aliquot (LIMS + lab notebook) loaded with the demo lab, drive the Staff app or Client portal in a real headless browser with agent-browser as a demo person, and prove behavior with screenshots plus API/audit-trail read-backs. Use to confirm a change works in the running app, not just in `npm test`.
---

# Verify Aliquot by driving it

Aliquot is one Node server (`server.js`, no dependencies, no build) that serves two browser surfaces:

- **Staff app** at `/`: history routes such as `/worklist` and `/tests/:id` (the full list is `ROUTES` in `public/js/main.js`). This is the primary surface.
- **Client portal** at `/portal/`: hash routes such as `#/samples` and `#/submit`.

Everything here uses the four helpers in `.claude/skills/verify/scripts/`. Each run has a name, `verify` by default. Pick another name to run two instances side by side.

| Path | Holds | Cleanup |
|---|---|---|
| `.verify/runs/<run>/` | data folder, `server.log`, `pid`, `base`, API cookies | deleted by cleanup |
| `.verify/evidence/<run>/` | screenshots and JSON read-backs | kept |

`.verify/` is gitignored.

Never drive `data/` (the lab's real database), and never drive `data-dev/` behind a user's `npm run dev` on :3001. Those belong to the user.

## Launch

```bash
.claude/skills/verify/scripts/launch.sh verify     # prints http://127.0.0.1:<port>
```

`launch.sh` does the following:

1. Seeds the fictional demo lab into a fresh data folder (`scripts/seed-demo.js`).
2. Starts `node server.js` with `PORT=0 HOST=127.0.0.1`.
3. Waits until `/api/setup` answers, then prints the base URL.

It refuses to start if that run is already up. The server loads `server/` code once at launch, so relaunch after server changes. A `public/` change only needs a browser reload.

The demo people all use password `demo1234`:

| Username | Role |
|---|---|
| `tom.fletcher` | analyst: receives samples, enters results, submits |
| `sarah.lindqvist` | senior scientist: peer review, witnessing, assigning |
| `daniel.okafor` | QA: approval, investigations, CoAs, audit trail |
| `priya.raman` | lab manager |
| `grace.holloway` | business & finance |
| `admin` | administrator: can't sign lab data |
| `customer@example.com` | portal contact (Acme) |

## Doctor

Run this first, and again whenever anything looks off:

```bash
.claude/skills/verify/scripts/doctor.sh verify
```

It is read-only. It checks:

- the pid is alive and is `node server.js`;
- the port is owned by that pid;
- the server uses this run's data folder;
- the lab is set up with demo data.

It prints the commit (`+dirty` when the tree has changes). Any `FAIL:` line means: stop, run cleanup, relaunch.

## Drive

**Browser.** Use the `agent-browser` CLI with one isolated session per run. Set the session name with the environment variable. Don't build it into a `$VAR`: the shell is zsh and won't word-split it.

```bash
export AGENT_BROWSER_SESSION=aliquot-verify
B=$(cat .verify/runs/verify/base); E=$PWD/.verify/evidence/verify
agent-browser set viewport 1440 1000            # demo sign-in buttons sit below the fold at the default size
agent-browser set media light reduced-motion    # skips the lock-screen intro, which otherwise covers the buttons
agent-browser open "$B/"
agent-browser wait '[data-demo="tom.fletcher"]'
agent-browser scrollintoview '[data-demo="tom.fletcher"]'
agent-browser click '[data-demo="tom.fletcher"]'
agent-browser wait 2000 && agent-browser get title    # "Dashboard · Aliquot" when signed in
```

**Switching person.** Open the user menu with `button.me-btn[data-menu="me"]`, then click `button[data-act="logout"]` ("Sign out"). Or run `agent-browser cookies clear` and reopen `$B/`.

**Screenshots** need an absolute path. A relative path lands in `~/.agent-browser/tmp`.

**Selectors.** Prefer `data-*` handles, `name=` attributes and `aria-label`s. The feature files list the real ones. The top bar's **New** menu keeps hidden copies of links such as `a[href="/samples/receive"]` in the DOM, and `wait`/`click` act on the first match, so a bare `a[href=…]` times out. Scope it to the visible one (`a.btn[href=…]`). The e-signature modal is the same everywhere:

1. Wait for `.modal input[name=password]`.
2. Fill it with `demo1234`.
3. Click `.modal-foot button[data-submit]`.

Toasts appear in `.toasts`. Read them with `agent-browser eval 'document.querySelector(".toasts")?.innerText'`. The Client portal uses a single `.toast` instead.

**Check every click that should change something.** A click can report `✓ Done` and change nothing, most often in a fast chain straight after `open` or after filling a modal. After each such click, read the toast, the URL or the record through `api.mjs`. If nothing changed, run doctor, then retry the click once.

**API read-back.** `scripts/api.mjs` signs in as a demo person and prints `{status, data}`. It exits 1 on HTTP ≥ 400. Use it to read the state a UI action should have changed, and to check refusals:

```bash
.claude/skills/verify/scripts/api.mjs verify tom.fletcher GET '/api/tests?scope=open&work=assigned'
.claude/skills/verify/scripts/api.mjs verify daniel.okafor GET '/api/audit?q=T-2026-00276&limit=10'   # audit.view: QA, manager, admin
.claude/skills/verify/scripts/api.mjs verify daniel.okafor GET /api/audit/verify                      # hash chain intact
```

Demo record IDs and codes depend on the seed date. Look them up through the API or the list screens on each run. Never hardcode them.

## Evidence

A proof is a set of files in `.verify/evidence/<run>/`, numbered in the order you took them:

- a screenshot before the action;
- a screenshot of the signing modal or form;
- a screenshot of the resulting screen;
- a JSON read-back of the record;
- the audit rows the action wrote.

Proof standards:

- **Drive the real user path.** That means a browser click as the right role. Use `api.mjs` to *read*, or to prove a refusal. Don't use it to make the change you are claiming works.
- **Show the action and the resulting state.** Status badge, toast, signature card, and the API record (`status`, `signatures[].meaning`).
- **Check side effects.** Every write leaves `audit_log` rows: `CREATE`/`UPDATE`/`STATUS`/`SIGN`, entity names are table names such as `tests`. `/api/audit/verify` must still return `ok: true`.
- **Prove refusals on the server.** A hidden button is not a proof. Call the endpoint as the person who must be refused and capture the 4xx. A missing permission or a wrong person is 403. A wrong state, such as a locked entry or an open investigation, is 400. Another client's portal record is 404.

## Cleanup

```bash
.claude/skills/verify/scripts/stop.sh verify
```

`stop.sh` does the following:

1. Closes this run's browser session.
2. Kills only the pid that `launch.sh` recorded, after checking it is still `node server.js`.
3. Deletes `.verify/runs/<run>/`.

It never kills by process name. Evidence in `.verify/evidence/<run>/` survives; delete it yourself once it has been reported. Run cleanup after every failed attempt too.

## Feature map

`features/README.md` indexes one file per user-facing feature, each with routes, real selectors, end state and gotchas. A proof of a feature covers every entry point its file lists, not just the most convenient one.
