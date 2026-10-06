# Receive samples

Log a delivery from a client: one form for the delivery, a row per sample (or paste rows from a spreadsheet), and the tests to run on each. Aliquot assigns sample codes `S-YYYY-NNNN` and creates one Pending, unassigned test `T-YYYY-NNNNN` per sample per method. Code: `public/js/views/samples.js` (`receive`, `showReceived`), server `receiveSamples` in `server/routes/lab.js`. Permission `samples.receive`: admin, manager, scientist, analyst. QA is refused.

## Sub-features

- Delivery fields:
  - `select[name=client_id]` (required), then `select[name=project_id][data-project]`, which fills in after a client is chosen. It lists only that client's open Projects (Quoted, Active, On Hold), picks the one automatically when there is exactly one, and reads "No open projects for this client" when there are none.
  - `select[name=sample_type]`, `select[name=condition]`, `select[name=storage]`, `input[name=location]`, `input[name=received_at]`, `textarea[name=notes]`.
  - Priority `a[data-p="Standard|Rush|Urgent"]`.
- Sample rows `tbody[data-rows] tr`:
  - Inputs `input[data-k=description|batch_no|client_ref|quantity|container]`, aria-labels like "Description row 1". Description is required for every non-empty row.
  - `[data-act=add]` "Add row", `[data-act=add5]`, `[data-act=fill]`, delete with `[data-del=<i>]`.
  - `[data-act=paste]` "Paste from spreadsheet": a modal with `textarea[name=text]` and the button "Add rows".
- Tests: checkboxes `input[name=method_ids]` in `label.method-opt`, filter `input[data-mfilter]`. Due date `input[name=due_date][data-due]`. Summary counters `[data-s=samples|methods|tests|codes]`.
- Labels: "Print N label(s)" (`[data-act=labels]`) opens `/print/labels` in a new window.

## How to get to it (user POV)

- **Samples** in the sidebar → the "Receive samples" button in the page head (`a.btn[href="/samples/receive"]`). The bare `a[href="/samples/receive"]` first matches the hidden copy in the New menu.
- Top bar **New** menu → Receive samples.
- The Dashboard's "Receive samples" button.
- A client's page (`/clients/:id`): `a.btn[href="/samples/receive?client=<id>"]` pre-selects the client.
- A Project's page (`/projects/:id`): `a.btn[href="/samples/receive?client=<id>&project=<id>"]` pre-selects the client and the Project. It is offered only from the Project's `can.receive`, so a Completed or Cancelled Project has no such button.
- From the staff Client portal inbox, on `/portal-inbox/submissions/:id`: `button[data-act=receive]` "Receive samples" is offered from the submission's `can.receive`, while it is Submitted or Acknowledged and to someone with `samples.receive`. It opens a modal "Receive N sample(s) from SUB-…". It has received_at, condition, storage, location, project (the client's open Projects), due date, `input[name=method_ids]` (inside `label.check`, not `label.method-opt`) and notes. Click "Receive & create samples" (`.modal-foot button[data-submit]`). The result is the toast "Received as S-…", not the "N sample(s) received" screen.

## Driving it with agent-browser

```bash
agent-browser open "$B/samples/receive"
agent-browser wait 'form[data-receive] select[name=client_id]'
agent-browser select 'select[name=client_id]' <client id>     # ids: api.mjs verify tom.fletcher GET /api/clients
agent-browser fill 'input[aria-label="Description row 1"]' 'Verification batch A'
agent-browser click 'label.method-opt:has(input[name=method_ids][value="<method id>"])'
agent-browser click 'form[data-receive] button[type=submit]'  # "Receive samples"
agent-browser wait 1500
agent-browser screenshot $E/receive-done.png
```

End state that proves it:

- **Screen:** heading "N sample(s) received", and a "Samples logged" card of `a.code[href="/samples/<id>"]` links.
- **API:** `GET /api/samples/<id>` returns `{sample, tests, custody, can}`: `sample.status` is `Received`, `custody[].action` includes "Received", and each of `tests[]` is `Pending` with `analyst_id` null.
- **Audit:** `CREATE` "Sample received" on `samples` for each sample, and `CREATE` "ATM-xxxx vN requested on S-…" on `tests` for each test.
- **Refusals:**
  - POST `/api/samples/receive` as daniel.okafor returns 403.
  - Receiving into a Completed Project, as someone allowed to receive, returns 400 ("That project is completed — reopen it before adding samples to it"); a Cancelled one gives "That project is cancelled — samples can't be added to it", and another client's Project "That project belongs to a different client". The demo lab has a Completed Acme Project, so no setup is needed: look it up with `GET /api/projects?client_id=<id>&status=all`. Editing a Sample into a closed Project is refused the same way.

## Gotchas

- With no method ticked, a confirm modal opens. Click "Receive without tests" (`[data-ok]`). It is an in-DOM modal, not a native dialog.
- Validation errors are toasts, not inline: "Choose the client", "Add at least one sample", "Every sample needs a description".
- Click the `label.method-opt` that contains the method checkbox.
- The new tests are unassigned. To continue into [test-results.md](test-results.md), assign one as sarah or priya: `/worklist?view=unassigned` → tick `td.sel input[data-id="<test id>"]` → `[data-act=assign]` (disabled until a row is ticked) → click `.modal input[name=analyst_id][value="<user id>"]` (one radio per person, labelled with the name; untrained people are disabled) → "Assign". Toast: "1 test assigned". The analyst must be trained on the method; Tom is trained on ATM-0001, 0002, 0004, 0006 and 0012.
