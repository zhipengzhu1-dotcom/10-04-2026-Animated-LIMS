# Peer review and QA approval

Submitted tests get a second person's review ("Reviewed" signature), then QA approval ("Approved"). When every test on a sample is approved, QA issues the Certificate of Analysis. Code: `public/js/views/reviews.js`, `public/js/views/tests.js`. Rules are in `TEST_RULES` (`server/workflow.js`). The reviewer must not be the analyst, and the approver must be neither the analyst nor the reviewer. On the test page, `[data-act=review-ok]`, `review-return`, `approve-ok` and `approve-return` come from the test's `can.review`, `can.return` and `can.accept` flags. On `/reviews`, every record in `GET /api/reviews` carries its own `can` too, and the row checkboxes, Sign, Witness and Issue come from it. Each tab is a Queue from `TEST_QUEUES`, `ENTRY_QUEUES` or `SAMPLE_QUEUES`, so a record is listed exactly when its rule offers the person that action.

## Sub-features

- **Bulk peer review:** `/reviews?tab=review`. Tick `input[data-pick=review]` (or `[data-all=review]`), click `button[data-bulk=review]` "Sign review (N)", then the modal button "Sign all".
- **Bulk approval:** `/reviews?tab=approve`. Tick `input[data-pick=approve]`, click `button[data-bulk=approve]` "Approve (N)", then the modal button "Approve all".
- **Single test:** on `/tests/:id`, use `[data-act=review-ok]` "Sign review" or `[data-act=review-return]` "Return". Return needs a reason in `textarea[name=comment]`, then the button "Return test", and sends the test back to In Progress. `[data-act=approve-ok]` (modal button "Approve") and `[data-act=approve-return]` do the same for approval. Toasts: "Review signed", "Result approved", "Returned to analyst". A Return at approval signs "Rejected at approval" and clears `reviewed_by`. While an Investigation is open on the test, `approve-ok` is disabled and a red notice explains why, but `approve-return` is still offered and allowed: an open Investigation blocks approving, never returning.
- **Notebook witnessing tab:** `?tab=witness`, see [notebook.md](notebook.md).
- **Certificates to issue:** `?tab=issue`. Click `button[data-issue=<sampleId>]` "Issue", then "Sign & issue" (POST `/api/samples/:id/report`). Toast "Certificate issued". The sample becomes Reported, and `GET /api/samples/<id>/coa` returns `final: true` with the signature "Certificate of Analysis issued". The tab lists the Approved samples the person may issue, which leaves out any held by an open investigation. The administrator's oversight (`/api/reviews?scope=lab`) lists every Approved sample, held ones included, with every `can` flag false.

## How to get to it (user POV)

- Sign in as `sarah.lindqvist` (review) or `daniel.okafor` (approve) → **Reviews & approvals** in the sidebar (`/reviews`). Its badge is the sum of every tab: review, approval, witness and certificates to issue (`GET /api/nav` → `reviews` equals the four list lengths in `GET /api/reviews`). Approving a sample's last test moves it from the approval count to the certificate count, so the badge holds steady; issuing the CoA lowers it by one. It opens on the first tab with items. Daniel (QA) also holds review rights, so plain `/reviews` usually opens on Peer review for him. Use `?tab=approve`.
- From a Submitted or Reviewed test's own page.

## Driving it with agent-browser

Typical chain: submit as Tom ([test-results.md](test-results.md)), review as Sarah, approve as Daniel.

```bash
# switch person: open the user menu, then sign out
agent-browser click 'button.me-btn[data-menu="me"]' && agent-browser click 'button[data-act="logout"]'
agent-browser wait '[data-demo="sarah.lindqvist"]' && agent-browser scrollintoview '[data-demo="sarah.lindqvist"]' && agent-browser click '[data-demo="sarah.lindqvist"]'
agent-browser open "$B/reviews?tab=review"
agent-browser click 'input[data-pick=review][value="<test id>"]'   # a bare checkbox, aria-label "Select <T-code>"; [data-all=review] ticks every row
agent-browser click 'button[data-bulk=review]'
agent-browser wait '.modal input[name=password]'
agent-browser fill '.modal input[name=password]' demo1234
agent-browser click '.modal-foot button[data-submit]'              # "Sign all"
```

Then repeat as daniel.okafor on `?tab=approve` with `data-pick=approve` and `data-bulk=approve`.

End state that proves it:

- **Screen:** toast "1 test reviewed" or "2 tests approved". The test badge reads REVIEWED or APPROVED. The Signatures card adds "Reviewed" or "Approved".
- **API:** `GET /api/tests/<id>` returns `test.status`, `test.reviewed_by`/`test.reviewed_at`, `test.approved_by`, and `signatures[].meaning` ("Performed", "Reviewed", "Approved").
- **Audit:** `GET /api/audit?entity=tests&entity_id=<id>` shows `SIGN Signed: Reviewed`, `STATUS Peer review passed`, `SIGN Signed: Approved` and `STATUS Result approved`.
- **Refusals:** send a body with the decision to `/review` and `/approve` alike, as the browser does: `'{"decision":"approve","password":"demo1234"}'`. Without `"decision":"approve"`, either call is treated as a Return. `/review` then answers 400 `REASON_REQUIRED` ("Explain why the test is being returned to the analyst"), and `/approve` skips the open-Investigation check and answers 400 `REASON_REQUIRED` ("Explain why the test is being returned"). POST `/api/tests/:id/review` as tom.fletcher returns 403, because analysts lack review rights. A scientist reviewing a test they performed also gets 403 ("You performed this test…"). POST `/api/tests/:id/approve` by the person who reviewed it returns 403 ("You reviewed this test…"). To set this up, have daniel.okafor review a Submitted test and then approve it. Approving a test whose investigation is still open returns 400 ("<INV> is still open…").

## Gotchas

- The bulk buttons stay disabled until a checkbox `change` event fires. Click the checkbox; don't set `.checked` with eval.
- A click on a test page's header button straight after `open` can report `✓ Done` and do nothing: no modal opens. After each signing click, check that the modal opened and then the toast; if not, retry the click once.
- A test held by an open investigation (OOS or any other) stays on the approve tab, because the approver may still return it, but it has no checkbox. The card's subtitle reads "A test held by an open investigation can be approved once the investigation is closed." While it is open, `approve-ok` on the test page is disabled and the API returns 400. Once it closes, the row gets its checkbox and can be bulk-approved, OOS or not.
- `/api/reviews` `toApprove` already leaves out tests the caller performed or reviewed. Pick rows whose `can.accept` is true; those are the rows with an `input[data-pick=approve]`.
