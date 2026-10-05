# Client portal

A separate sign-in at `/portal/` where a client's contacts follow their own samples, download issued CoAs, submit samples and message the lab. Each contact only sees their own company's records. Code: `public/portal/portal.js` (hash routes), server `server/routes/portal.js`, staff side `public/js/views/portal-inbox.js`.

## Sub-features

- Sign-in: `input[name=email]`, `input[name=password]`, button `.ak-btn` "Request". There are also demo buttons: `button[data-demo="customer@example.com"]` (Dr. Laura Chen, Acme), `felix.romero@bluestone-bio.example` (Bluestone) and `hannah.schultz@northwind-tx.example` (Northwind).
- Samples: `#/samples?tab=open|reported|all|shipments`, detail at `#/samples/<id>`, CoA at `#/coa/<id>`. A submission's detail is `#/submissions/<id>`.
- Submit samples (`#/submit`, form `#submission`):
  - Rows `[data-row]` with `input[name="s.description"]` (required), `s.batch_no`, `s.client_ref`, `s.quantity`, `s.container`. "Add another sample" is `.js-add`.
  - Tests are `input[name=method_ids]`.
  - Other fields: `select[name=project_id]`, `select[name=sample_type]`, `select[name=storage]`, `input[name=priority]`, `input[name=courier]`, `input[name=tracking_no]`, `input[name=ship_date]`, `textarea[name=notes]`.
- Method development or validation requests: `#/requests`, new at `#/requests/new` (form `#request`, "Send request").
- Messages:
  - `#/messages` lists threads.
  - "New" (`.threads-card a[href="#/messages/new"]`; the bare selector matches more than one link) opens form `#newthread` with `input[name=subject]`, `select[name=sample_id]` and `textarea[name=body]`, then "Send".
  - Reply with form `#reply` and its `textarea[name=body]`. Cmd/Ctrl+Enter sends.
- Account (`#/account`, which also has its own `button.js-out` "Sign out") and sign-out: `button.avatar.js-me`, then `button.js-signout`.

## How to get to it (user POV)

- Open `<base>/portal/` and sign in as a client contact.
- Navigate with the top nav: `.nav a[data-nav=overview|samples|submit|requests|messages]`.
- Staff see the other side under **Client portal** in the sidebar (`/portal-inbox`). It opens on Messages. Submissions are at `/portal-inbox?tab=submissions`, and a submission's detail is at `/portal-inbox/submissions/<id>`.

## Driving it with agent-browser

```bash
agent-browser open "$B/portal/"
agent-browser wait --fn '!document.getElementById("splash")'   # the splash can cover the demo buttons after they render
agent-browser wait '[data-demo="customer@example.com"]'
agent-browser scrollintoview '[data-demo="customer@example.com"]'
agent-browser click '[data-demo="customer@example.com"]'
agent-browser wait 'header.top nav.nav a[data-nav]'
agent-browser click '.nav a[data-nav=submit]'
agent-browser wait '#submission input[name="s.description"]'
agent-browser fill '#submission input[name="s.description"]' 'Portal verification sample'
agent-browser click '#submission button[type=submit]'          # "Submit"
agent-browser wait '.card.success h1'                          # "Submission SUB-YYYY-NNNN received"
```

End state that proves it:

- **Screen:** "Submission SUB-… received", with links "View submission" and "Back to overview".
- **API:** as a staff user, `GET /api/portal-admin/submissions` lists the new code with status `Submitted`, and `GET /api/portal-admin/threads` has an automatic thread "Sample submission SUB-…".
- **Messages:** after sending, the new `.msg.client .bubble` appears in `#msgs`. The staff badge is `[data-badge=portal]` in the sidebar, the same number as `GET /api/nav` → `portal`. It counts Submitted submissions, Submitted method requests, and threads with unread client messages. A new submission adds 1, because its automatic thread holds only a system event. A new client thread adds 1.
- **Isolation:** a contact from another company (e.g. `felix.romero@bluestone-bio.example`) must not see Acme's records. Under Felix's portal session:
  - GET `/api/portal/samples/<acme id>`, `/samples/<id>/coa`, `/threads/<id>` and `/submissions/<id>` return 404, and so does POST `/threads/<id>/messages`.
  - His lists are not empty: they hold Bluestone's own seeded rows. Check that they contain no Acme codes or subjects.

## Gotchas

- The portal uses its own cookie and session, separate from the staff app's. Signing in to one does not sign in to the other.
- The nav links render twice (desktop `.nav` and mobile `nav.tabbar`). Scope selectors to `.nav`.
- "Withdraw" on a submission (`.js-withdraw`) calls native `confirm()`, which blocks automation. Avoid it, or accept the dialog.
- The portal shows a splash and an `.arrive` animation, plus skeleton loaders after about 160 ms. Wait for content selectors, not fixed times.
- `scripts/api.mjs` signs in through the staff login only. For portal API reads, sign in yourself and keep the jar in the run folder so cleanup removes it:
  ```bash
  curl -s -c .verify/runs/verify/portal-acme.jar -H 'X-Requested-With: aliquot' -H 'Content-Type: application/json' \
    -d '{"email":"customer@example.com","password":"demo1234"}' "$B/api/portal/login"
  curl -s -b .verify/runs/verify/portal-acme.jar "$B/api/portal/submissions"
  ```
  Every non-GET needs `X-Requested-With: aliquot`, or the server answers 403. A portal cookie gets 401 on staff endpoints.
- **Input wedge after `#/submit`.** Once the browser has shown `#/submit`, agent-browser's clicks and key presses soon stop reaching that tab, often on the next click or the one after. They still report `✓ Done`, but nothing happens. `eval` and `open` keep working, and a reload doesn't help. This happens even when nothing on the form was touched, and `#/requests/new` does not cause it. Check `agent-browser eval 'location.hash'` after each portal click. To recover, open a fresh tab with `agent-browser tab new "$B/portal/#/"`; the portal session carries over. The cause is not known. Prove the submission first, then switch tabs.
