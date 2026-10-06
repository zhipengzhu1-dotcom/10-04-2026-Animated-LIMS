# Enter results and submit a test

An analyst opens a test assigned to them, types results (checked live against specification), records the instrument, and e-signs "Performed" to submit it for peer review. Code: `public/js/views/tests.js`, rules in `TEST_RULES` (`server/workflow.js`). Statuses: Pending → In Progress → Submitted → Reviewed → Approved, or Cancelled. The header buttons come from the test's `can` flags (`GET /api/tests/:id` → `can`), so a button is shown exactly when the server would accept it.

## Sub-features

- Start a test (`[data-act=start]` "Start test", only for the assigned analyst on a Pending test) or pick up an unassigned Pending one (`[data-act=claim]` "Pick up this test", only for someone qualified on the method).
- Numeric results with a live outcome in `td[data-outcome]`: "Pass", "OOS" for a failing value, "Reported" when the analyte has no limits. Text results with a specification text have a Conforms / Does not toggle; without one they are "Reported".
- Instrument (`select[name=instrument_id]`), required unless the technique is Physical / Visual or Gravimetric. Instruments out of calibration, Out of Service or in Maintenance are disabled, and Retired ones are not listed.
- Standards, reagents and columns (`input[name=material_ids]`), raw data reference (`input[name=raw_data_ref]`), comments (`textarea[name=comments]`).
- Save (`button[data-save]`, PUT `/api/tests/:id`, moves Pending to In Progress).
- Save & submit (e-sign "Performed", POST `/api/tests/:id/submit`). A failing result opens an OOS investigation automatically.
- Changing a recorded result asks for a reason: modal `textarea[name=reason]`, then "Continue".
- Files (`TEST_RULES.attach`): only the assigned analyst, or someone who assigns tests, may attach, and only before the test is submitted. After that the Files panel shows "The test is submitted — attachments are locked" instead of the drop zone.

## How to get to it (user POV)

- Sign in as `tom.fletcher` → **Worklist** in the sidebar (`/worklist`, defaults to "My tests") → click the test code `a.code[href="/tests/<id>"]`. My tests leaves out tests whose method the analyst's qualification has lapsed on.
- From a sample page (`/samples/:id`), click a test row.
- Search with ⌘K for the test code.

## Driving it with agent-browser

Find an open test first. Tom's list is usually short, and IDs change with the seed date:

```bash
.claude/skills/verify/scripts/api.mjs verify tom.fletcher GET '/api/tests?scope=open&work=assigned'
.claude/skills/verify/scripts/api.mjs verify tom.fletcher GET /api/tests/<id>    # results[].id, result_type, spec; instruments[]
```

Example from one seed (test 276, FTIR, one text result `518`, instrument 10 = Thermo Nicolet iS20). On 2026-10-05 the same steps proved a Pending Dissolution test with two numeric results and instrument 11. In the browser, Save & submit works straight from Pending, because it saves first and the save moves the test to In Progress. A direct POST `/api/tests/:id/submit` on a Pending test returns 400 ("Only tests in progress can be submitted").

```bash
agent-browser open "$B/tests/276"
agent-browser wait '.r-input[data-rid="518"]'
agent-browser screenshot $E/03-test-before.png
agent-browser fill '.r-input[data-rid="518"]' 'Conforms to reference spectrum'
agent-browser click 'label:has(input[name="o-518"][value=Pass])'      # text results need Conforms ticked
agent-browser select 'select[name=instrument_id]' 10
agent-browser click '.btn-group button[data-act=submit]'               # "Save & submit for review"
agent-browser wait '.modal input[name=password]'
agent-browser fill '.modal input[name=password]' demo1234
agent-browser click '.modal-foot button[data-submit]'                  # "Sign & submit"
agent-browser wait 1500
agent-browser eval 'document.querySelector(".toasts")?.innerText'      # "Submitted for review"
agent-browser screenshot $E/05-test-submitted.png
```

For numeric results, `fill '.r-input[data-rid="<id>"]' 99.8` and read `td[data-outcome]`. A missing instrument shows the toast "Choose the instrument you used before submitting".

End state that proves it:

- **Screen:** the badge reads SUBMITTED, the stepper is on Submitted, the Signatures card shows "Performed · Tom Fletcher", the result shows PASS, and the Files panel reads "The test is submitted — attachments are locked".
- **API:** `GET /api/tests/<id>` returns `test.status = "Submitted"`, `test.submitted_at` set, `test.instrument_id` set, a last `signatures[].meaning` of "Performed", and `can.edit` and `can.attach` false. A test that was returned earlier also carries older signatures. `GET /api/attachments?entity=tests&id=<id>` returns `can.attach: false` and the lock message in `locks.attach`.
- **Audit:** `GET /api/audit?q=<test code>` (as daniel.okafor) shows "Results recorded", `SIGN Signed: Performed` and `STATUS Submitted for review`, all by tom.fletcher. "Results recorded" is a `STATUS` row when the test was Pending and an `UPDATE` row when it was already In Progress. `GET /api/audit/verify` returns `ok: true`.
- **OOS path:** a failing result shows the toast "Submitted. OOS investigation <code> opened", and the test's `investigations[]` is non-empty.

## Gotchas

- The Conforms / Does not radios are visually hidden inside `label.p`. Clicking the `input` reports "covered by div.route-progress". Click the `label:has(...)` instead.
- `agent-browser find text 'Save & submit for review'` does not find the button. Use `.btn-group button[data-act=submit]`. When the test is already In Progress, the header has a second `[data-act=submit]` ("Submit for review"), so scope to `.btn-group`.
- A wrong password keeps the modal open with "Incorrect password — signature not applied" in `.modal .form-error`. Five failures lock the account for 15 minutes, and signature failures count toward the five. While locked, a signature returns 423.
- `/tests/:id` has a `beforeunload` guard when results are dirty. A full `open` or `reload` with unsaved input triggers a native dialog that blocks automation, so save first.
- Analysts cannot review: POST `/api/tests/:id/review` as tom.fletcher returns 403 FORBIDDEN. The reviewer must also differ from the analyst, and the approver from both.
