# Aliquot: a LIMS and electronic lab notebook for contract analytical labs

Aliquot replaces the paper side of a contract analytical laboratory: sample login sheets, worksheets, instrument logbooks, standards registers, lab notebooks, review stamps, OOS forms, training files and the invoicing spreadsheet. It's one web app that the whole team uses from a browser on the lab network.

It was built for a lab that develops methods and tests samples for pharmaceutical clients, with 20+ people in different roles: analysts, scientists, QA, lab management and business/finance.

**Try it online:** [animated.nitrolims-demo.com](https://animated.nitrolims-demo.com) runs the fictional demo lab. Click a demo person on the sign-in screen (password `demo1234`). The client portal is at [/portal/](https://animated.nitrolims-demo.com/portal/). Anyone can change the demo data, and it resets to fresh demo data every night.

---

## Start it in 2 minutes

**You need:** [Node.js](https://nodejs.org) version 22.13 or newer (choose the LTS download). There is nothing else to install: no database server and no `npm install`.

**On a Mac:** double-click **`Start Aliquot.command`**.
**On Windows:** double-click **`Start Aliquot.bat`**.
**Or from a terminal:** `node server.js`

Then open **http://localhost:3000**. The first screen gives you two choices:

| Option | What you get |
|---|---|
| **Explore with demo data** | A fictional lab with 22 people, 5 clients, about 100 samples, 300 tests, OOS investigations, notebook entries and invoices covering 5 months. Use it to try everything and to train the team. |
| **Set up my laboratory** | An empty system and your first administrator account. |

Do this first-time setup **on the computer running Aliquot**. For security, it is refused from other machines, so no one else on the network can claim the administrator account. After that, the terminal window shows the address your colleagues can use, for example `For your team: http://192.168.1.64:3000`. Keep that window open while the lab is working.

### Demo accounts (password `demo1234` for everyone)

| Sign in as | Role | Try this |
|---|---|---|
| `priya.raman` | Lab Manager | Dashboard, assigning work, approvals, insights |
| `tom.fletcher` | Analyst | My worklist → enter results → sign and submit |
| `sarah.lindqvist` | Senior Scientist | Reviews & approvals → peer review |
| `daniel.okafor` | Quality Assurance | QA approval, closing OOS investigations, issuing CoAs, audit trail |
| `grace.holloway` / `oliver.grant` | Business & Finance | Clients, projects, "ready to bill", invoices |
| `admin` | Administrator | Team accounts, settings |

The sign-in page has one-click buttons for these accounts while demo mode is on.

### Moving from the demo to real use

1. Stop Aliquot (close the window, or press Ctrl+C).
2. Rename or delete the `data` folder.
3. Start Aliquot again and choose **Set up my laboratory**.
4. Then:
   - Go to **Settings** and enter your lab's name, address, currency and tax.
   - Go to **Team** and add your people.
   - Go to **Methods** and enter your methods, or ask for help importing your method list.
   - Go to **Instruments** and **Standards & reagents** and register your equipment and materials.
   - Go to **Team → Training matrix** and record who is qualified on what.

---

## What replaces what

| On paper today | In Aliquot |
|---|---|
| Sample receipt log / chain-of-custody form | **Receive samples**: log a whole delivery at once (paste rows from Excel), automatic sample codes, barcode labels, custody trail |
| Worksheet / analyst's bench sheet | **Test page**: results checked against specification as you type, instrument and standard/reagent lots recorded, raw data reference, attachments |
| "Checked by" stamp, QA release signature | **Electronic signatures**: performed → peer reviewed → QA approved, each one by a different person and password-confirmed |
| Bound lab notebook, loose Word/Excel files | **Lab notebook**: templates, tables, autosave, plus Word and Excel files that open in the desktop apps with every save kept as a version; signing locks the entry and its files, a colleague witnesses it, corrections become dated addenda |
| Instrument logbook | **Instruments**: calibration and maintenance log; instruments past their calibration date are blocked from use automatically |
| Standards and reagents register | **Standards & reagents**: lots, potency, expiry and stock; expired material can't be selected, and every test that used a lot is traceable |
| OOS / deviation forms | **Investigations**: OOS investigations open automatically when an out-of-spec result is submitted, and the result can't be approved until QA closes the investigation |
| Training records binder | **Training matrix**: only qualified people can be assigned a method |
| Typed Certificate of Analysis | **CoA**: generated from approved data, e-signed by QA, printed or saved as PDF |
| Invoicing spreadsheet | **Invoices**: approved work becomes invoice lines in two clicks; nothing is billed twice or forgotten |
| Whiteboard / weekly meeting | **Dashboard and Insights**: workload, due dates, alerts, turnaround, on-time %, OOS rate, revenue, unbilled work |

**Finding things:** press **⌘K** (or Ctrl+K, or `/`) anywhere to search. A USB barcode scanner works too: scan a sample label into the search box and the sample opens.

**Fitting more on screen:** the layout is compact by default. Switch to **Comfortable** in the user menu (bottom-left) if you prefer more space, and press `[` or the ☰ button to collapse the sidebar to icons. The **Tuned / Full HUD** switch in the top bar (or the user menu on a phone) changes how much the interface puts on show: Tuned keeps work screens calm, Full HUD adds a DNA helix behind the work screens, corner brackets and a live readout strip. These settings are remembered on each computer.

### Word and Excel in the notebook

Keep using Word and Excel for the parts of an entry that live there: calculation sheets, method drafts and protocols.

- **Add a document** to a draft entry from a template (blank Word, blank Excel, or the replicate-statistics sheet), or attach an existing `.docx`/`.xlsx`. Files with macros are refused.
- **Open in Word / Open in Excel** launches the desktop app. Press Save as usual and the file goes straight back into Aliquot; the entry shows the new version within a few seconds. This works with Office on Windows. Office for Mac usually opens such links read-only, so on a Mac use **Download**, edit, then **Upload new version**.
- **How the link works:** Word and Excel can't use your browser's sign-in, so each Open creates a private link that only works for that one document, for you, while the entry is a draft, and for at most 12 hours. Links are stored only as fingerprints and stop working when the entry is signed or the document removed. Because the link is the key, serve Aliquot over HTTPS whenever it's reachable beyond a trusted lab network.
- **Every save is a new version**, recorded in the audit trail with who, when and the file's SHA-256 fingerprint. Older versions can be previewed and downloaded at any time.
- **A preview** of the current version is shown in the entry, so reviewers and witnesses don't need Office.
- **Signing the entry freezes its documents.** The versions in it at that moment are the ones signed, and no further versions can be added.

### Client portal

Customers get their own sign-in at `/portal/` (for example `http://<lab-server>:3000/portal/`). It is completely separate from the staff app, and each contact only ever sees their own company's records.

- **Clients can:** follow their samples from arrival to certificate, download issued CoAs, submit samples (the lab then receives them in one click), request method development or validation, and message the lab in threads.
- **Staff work it from Client portal** in the sidebar. The badge counts unread messages and new submissions and requests. Method requests can be turned into a project.
- **Inviting a contact:** Client portal → Portal accounts → Invite. The contact gets a one-time temporary password and must change it at first sign-in. Send it by a separate channel, such as phone. After 5 wrong passwords an account locks for 15 minutes.
- **Demo contacts** (password `demo1234`): **customer@example.com** (Dr. Laura Chen, Acme), felix.romero@bluestone-bio.example, hannah.schultz@northwind-tx.example.
- **Before clients use it from outside your network,** serve Aliquot over HTTPS (see *Running it for the whole lab*).
- **Not included yet:** email notifications, and file attachments on portal messages.

---

## Roles

| Role | Can |
|---|---|
| Analyst | Receive samples, perform tests assigned to them, keep a notebook, record instrument and stock events, raise investigations |
| Senior Scientist | Everything an analyst can, plus assign work, edit methods, peer-review results, witness notebook entries |
| Lab Manager | Run the lab: assign, review, approve, cancel, issue CoAs, manage training, see billing |
| Quality Assurance | Approve results and methods, close investigations, issue CoAs, manage training, read the audit trail |
| Business & Finance | Clients, projects, invoices and insights (read-only on lab data) |
| Administrator | User accounts and settings. Deliberately can't sign lab data. |

Whatever the role, no one can review or approve their own work.

---

## Data integrity (21 CFR Part 11 / EU GMP Annex 11 / ALCOA+)

Built in:

- **Unique accounts, role-based permissions.** Every rule is enforced on the server, not just hidden in the screen.
- **Electronic signatures.** Each signature requires a password, records its stated meaning, and is linked to the record and stored in a table the database refuses to change.
- **Audit trail.** Every create, change, signature, print and sign-in is recorded with who, when (UTC), old → new values and the reason. The trail is append-only (enforced by the database) and hash-chained, so **Audit trail → Verify integrity** detects any edit made outside the app. You can export it to CSV for inspections.
- **A reason is required** to change a result that has already been recorded.
- **Signed records are locked:**
  - Approved results
  - Signed notebook entries and their Word/Excel versions (corrections are made as addenda)
  - Closed investigations
  - Issued invoices
  - Effective methods (change them through a new version)
  - Removed files are hidden, never deleted.
- **Sessions:** automatic sign-out after inactivity (configurable). After 5 wrong passwords the account locks for 15 minutes.
- **Controls that prevent mistakes:**
  - Training is checked before work can be assigned.
  - Calibration status is checked before an instrument can be used.
  - Expiry is checked before a standard or reagent can be used.
  - An open OOS investigation blocks approval.

**Your responsibility (not something software can do for you):** Aliquot is designed to *support* compliance. It isn't a validated system out of the box. Before using it for GMP release decisions, you'll need to do the following:

- Validate it for your intended use (URS → risk assessment → IQ/OQ/PQ). The automated tests in `test/` are a useful starting point for OQ.
- Write SOPs for its use, account management, audit-trail review and backup/restore.
- Train the team.
- Run it on controlled IT infrastructure.

---

## Running it for the whole lab

- **Where to run it:** any always-on computer or small server on the lab network (Mac, Windows or Linux). It is light: a basic office PC handles a lab of 20–50 people easily.
- **Firewall:** allow incoming connections on port 3000 (your computer may ask the first time).
- **Your data:** everything lives in the `data/` folder:
  - `aliquot.db` is the database.
  - `files/` holds attachments.
  - `backups/` holds the daily snapshots.
- **Backups:** Aliquot writes a consistent snapshot every day to `data/backups/` and keeps the last 14. **Copy that folder off the machine regularly** (network drive or cloud). For an on-demand backup, run `npm run backup` (or `node scripts/backup.js D:\Backups\Aliquot`).
- **Restoring:** stop Aliquot, put a backed-up `aliquot.db` (and `files/`) into `data/`, then start it again.
- **Access from outside the lab** (home or client sites): don't expose port 3000 directly. Put it behind a reverse proxy that provides HTTPS, such as [Caddy](https://caddyserver.com) or nginx, and set `SECURE_COOKIES=1`. This is required before clients use the portal or anyone uses *Open in Word/Excel* from outside the lab network.

### The public demo

[animated.nitrolims-demo.com](https://animated.nitrolims-demo.com) runs on one Mac. `deploy/` holds a copy of each file that sets it up; the installed copies are the ones that run, so change both together.

| File in `deploy/` | Installed at | What it does |
|---|---|---|
| `com.aliquot.animated.plist` | `~/Library/LaunchAgents/` | Runs `server.js` from the live copy on 127.0.0.1:3003, with its data in `~/Aliquot-Animated-data` |
| `com.aliquot.animated-tunnel.plist` | `~/Library/LaunchAgents/` | Keeps the Cloudflare Tunnel running |
| `cloudflared.yml` | `~/.cloudflared/aliquot-animated.yml` | Sends the hostname to port 3003. The tunnel's credentials file stays out of the repository |
| `com.aliquot.animated-reset.plist` | `~/Library/LaunchAgents/` | Runs the reset at 03:05 every night |
| `reset.sh` | `~/Aliquot-Animated-data/reset.sh` | Stops the demo, loads fresh demo data and starts it again |

- **The live copy is its own clone,** `~/Desktop/Claude/10. October 2026/Aliquot-Animated-live`, kept on `main`. Work in a different clone: every file under `public/` is served the moment it changes.
- **To publish `main`:** `git -C ~/"Desktop/Claude/10. October 2026/Aliquot-Animated-live" pull --ff-only`, then `launchctl kickstart -k gui/$(id -u)/com.aliquot.animated` to restart the server.

### Settings via environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to listen on (`127.0.0.1` means this computer only) |
| `ALIQUOT_DATA` | `./data` | Where the database, files and backups are kept |
| `SECURE_COOKIES` | off | Set to `1` when served over HTTPS |
| `SHIPPED_MODULES` | every module | Comma-separated module keys to ship, e.g. `samples,methods,invoices`. Other modules are withheld: gone from the app and their APIs answer "not found". Keys: `dashboard`, `samples`, `worklist`, `reviews`, `notebook`, `methods`, `instruments`, `inventory`, `investigations`, `audit`, `clients`, `projects`, `invoices`, `portal`, `insights`, `team`, `settings`. An unknown key stops start-up |
| `CLOUDFLARE_TUNNEL` | off | Set to `1` when Aliquot is published through Cloudflare Tunnel and listens on `127.0.0.1`. Connections from this computer then take the visitor's address from Cloudflare's `CF-Connecting-IP` header (for sessions, the audit trail and the setup check), so first-time setup works only on this computer and demo data can't be loaded. When off, the header is ignored. |

---

## For developers

- **Zero dependencies.** Node's built-in `http`, `crypto` and `node:sqlite`. The front end is plain ES modules with no build step. The one exception is three.js, which draws the helix on the sign-in screen: it is copied into `public/vendor/three/` with its licence and served by Aliquot itself, so it works without internet access. Without WebGL the sign-in shows a still drawing instead.
- `server/`: database schema and migrations (`schema.js`), audit trail (`audit.js`), auth and e-signatures (`auth.js`), and one route module per area in `routes/`. `lab.js` holds the core sample/test workflow.
- `public/js/`: the single-page app. Core helpers are in `core/` (escaping templates, tables, modals, charts, barcodes) and there is one module per screen in `views/`.
- `npm run dev` starts a development copy on http://localhost:3001 with its own `data-dev/` folder, reachable from this computer only, and restarts when server code changes. It never touches the lab's `data/`.
- `npm run check` syntax-checks every JavaScript file.
- `npm test` runs the end-to-end tests: it starts a server on a temporary database and walks the full workflow, including every control that must refuse.
- **Upgrade test:** `test/upgrade.test.js` starts the current code against a database from an earlier release (in a throwaway copy) and checks that migrations apply, no records are lost and the audit chain still verifies. It runs every `test/fixtures/*.db`. Before a release, also run it against a recent backup: `UPGRADE_FROM=path/to/backup npm run test:upgrade` (a `.db` file, or a backup folder with `aliquot.db` and `files/`). On Windows use `set UPGRADE_FROM=...` first.
- **CI:** every push to `main` and every pull request runs `npm run check` and `npm test` on Windows, macOS and Linux with Node 22.13 and 24 (`.github/workflows/ci.yml`).
- **Schema changes:** add a new entry to `MIGRATIONS` in `server/schema.js`. Never edit one that has already run.

### Ideas for next steps

- Import results directly from the CDS or instrument software (Empower, Chromeleon, LabSolutions).
- Email notifications for the client portal, and attachments on portal messages.
- Quotes that turn into projects.
- Stability study scheduling (pull calendar per ICH timepoints).
- Email or Teams notifications.
- Single sign-on (Microsoft 365 / Google).
- Reagent preparation records with automatic expiry.
- Periodic audit-trail review workflow.
