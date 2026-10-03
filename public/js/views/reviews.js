import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { can } from '../core/state.js';
import { icon } from '../core/icons.js';
import { refreshNav, setQuery } from '../core/nav.js';
import {
  pageHead, card, priorityBadge, dueChip, relTime, plural, emptyState, esign, toast, outcomeBadge, resultText, person, badge, segmented,
} from '../core/ui.js';

function resultsInline(t) {
  return html`<div class="row" style="gap:6px 12px;margin-top:4px">${t.results.map((r) => html`<span class="small nowrap"><span class="muted">${r.analyte}:</span> <span class="mono">${resultText(r)}</span> ${r.outcome === 'Fail' ? outcomeBadge('Fail') : ''}</span>`)}</div>`;
}

function testTable(list, kind) {
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th class="sel"><input type="checkbox" data-all="${kind}" aria-label="Select all"></th><th>Test</th><th>Results</th><th>${kind === 'review' ? 'Analyst' : 'Reviewed by'}</th><th>Waiting</th><th>Due</th></tr></thead>
    <tbody>${list.map((t) => html`<tr class="${t.oos ? 'row-fail' : ''}">
      <td class="sel"><input type="checkbox" data-pick="${kind}" value="${t.id}" ${t.oos ? raw('data-oos="1"') : ''} aria-label="Select ${t.code}"></td>
      <td class="title-cell"><a href="/tests/${t.id}"><strong>${t.method_title}</strong></a> ${priorityBadge(t.priority)}${t.oos ? badge('OOS', 'red', { dot: false }) : ''}
        <span class="sub-line"><span class="code">${t.code}</span> · ${t.sample_code} · ${t.client_code} · ${t.method_code} v${t.method_version}</span></td>
      <td>${resultsInline(t)}</td>
      <td>${kind === 'review' ? person(t.analyst_name, t.analyst_id, t.analyst_initials) : html`${t.reviewer_name}<span class="sub-line">analyst ${t.analyst_name}</span>`}</td>
      <td class="nowrap muted small">${relTime(kind === 'review' ? t.submitted_at : t.reviewed_at)}</td>
      <td>${dueChip(t.due_date)}</td>
    </tr>`)}</tbody></table></div>`;
}

export async function render(ctx) {
  ctx.title('Reviews & approvals');
  const d = await api.get('/api/reviews');
  const sections = [
    can('tests.review') && { key: 'review', label: 'Peer review', count: d.toReview.length },
    can('tests.approve') && { key: 'approve', label: 'QA approval', count: d.toApprove.length },
    can('notebook.witness') && { key: 'witness', label: 'Notebook witnessing', count: d.toWitness.length },
    can('reports.issue') && { key: 'issue', label: 'Certificates to issue', count: d.toIssue.length },
  ].filter(Boolean);
  if (!sections.length) {
    ctx.el.innerHTML = String(html`${pageHead({ title: 'Reviews & approvals' })}${emptyState({ icon: 'lock', title: 'Nothing for your role', text: 'Reviews and approvals are done by scientists, managers and QA.' })}`);
    return;
  }
  const active = sections.find((s) => s.key === ctx.query.tab)?.key || sections.find((s) => s.count)?.key || sections[0].key;

  let body;
  if (active === 'review') {
    body = d.toReview.length ? card({
      title: 'Waiting for peer review',
      sub: 'You can review anything you did not perform yourself.',
      actions: html`<button class="btn primary" data-bulk="review" disabled>${icon('sign', { size: 15 })}Sign review</button>`,
      flush: true,
      body: testTable(d.toReview, 'review'),
    }) : emptyState({ icon: 'check', title: 'No tests waiting for review', text: 'Nice — the review queue is empty.' });
  } else if (active === 'approve') {
    body = d.toApprove.length ? card({
      title: 'Waiting for QA approval',
      sub: 'Tests with an OOS result must be approved one at a time from the test page, after the investigation is closed.',
      actions: html`<button class="btn primary" data-bulk="approve" disabled>${icon('sign', { size: 15 })}Approve</button>`,
      flush: true,
      body: testTable(d.toApprove, 'approve'),
    }) : emptyState({ icon: 'check', title: 'Nothing waiting for approval' });
  } else if (active === 'witness') {
    body = d.toWitness.length ? card({
      title: 'Signed notebook entries waiting for a witness',
      flush: true,
      body: html`<ul class="list">${d.toWitness.map((n) => html`<li class="link" data-href="/notebook/${n.id}"><div class="grow"><div class="title">${n.title}</div><div class="meta"><span class="code">${n.code}</span> · ${n.author_name}${n.project_code ? ` · ${n.project_code}` : ''} · signed ${relTime(n.signed_at)}</div></div><a class="btn sm" href="/notebook/${n.id}">Read & witness</a></li>`)}</ul>`,
    }) : emptyState({ icon: 'book', title: 'Nothing to witness' });
  } else {
    body = d.toIssue.length ? card({
      title: 'Samples with every test approved',
      sub: 'Check the certificate, then sign to issue it.',
      flush: true,
      body: html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Sample</th><th>Client</th><th>Tests</th><th>Due</th><th></th></tr></thead>
        <tbody>${d.toIssue.map((s) => html`<tr class="${s.has_oos ? 'row-fail' : ''}">
          <td><a class="code" href="/samples/${s.id}">${s.code}</a><span class="sub-line">${s.description}${s.batch_no ? ` · ${s.batch_no}` : ''}</span></td>
          <td>${s.client_name}${s.project_code ? html`<span class="sub-line">${s.project_code}</span>` : ''}</td>
          <td>${s.test_count} ${s.has_oos ? badge('Contains OOS', 'red') : badge('All pass', 'green')}</td>
          <td>${dueChip(s.due_date)}</td>
          <td class="right nowrap"><a class="btn sm" href="/print/coa/${s.id}" target="_blank">${icon('eye', { size: 13 })}Preview</a> <button class="btn sm primary" data-issue="${s.id}" data-code="${s.code}">${icon('sign', { size: 13 })}Issue</button></td>
        </tr>`)}</tbody></table></div>`,
    }) : emptyState({ icon: 'method', title: 'No certificates to issue' });
  }

  ctx.el.innerHTML = String(html`
    ${pageHead({ title: 'Reviews & approvals', sub: 'Everything waiting for your signature. Four-eyes principle: you never review or approve your own work.' })}
    <div class="toolbar">${segmented(sections.map((s) => ({ ...s, href: setQuery({ tab: s.key }) })), active)}</div>
    ${body}`);

  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) window.dispatchEvent(new CustomEvent('aq:navigate', { detail: el.dataset.href })); }));

  // Bulk signing: one signature covers each listed record individually.
  const syncBulk = (kind) => {
    const picked = [...ctx.el.querySelectorAll(`[data-pick="${kind}"]:checked`)];
    const btn = ctx.el.querySelector(`[data-bulk="${kind}"]`);
    if (!btn) return;
    btn.disabled = !picked.length;
    btn.innerHTML = String(html`${icon('sign', { size: 15 })}${kind === 'review' ? 'Sign review' : 'Approve'}${picked.length ? ` (${picked.length})` : ''}`);
  };
  ctx.el.addEventListener('change', (e) => {
    if (e.target.dataset.all) {
      ctx.el.querySelectorAll(`[data-pick="${e.target.dataset.all}"]`).forEach((c) => { if (!(e.target.dataset.all === 'approve' && c.dataset.oos)) c.checked = e.target.checked; });
      syncBulk(e.target.dataset.all);
    }
    if (e.target.dataset.pick) {
      if (e.target.dataset.pick === 'approve' && e.target.dataset.oos && e.target.checked) {
        e.target.checked = false;
        toast('OOS results must be approved individually from the test page', 'info');
      }
      syncBulk(e.target.dataset.pick);
    }
  });
  ctx.el.addEventListener('click', async (e) => {
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      const kind = bulk.dataset.bulk;
      const ids = [...ctx.el.querySelectorAll(`[data-pick="${kind}"]:checked`)].map((c) => Number(c.value));
      const list = (kind === 'review' ? d.toReview : d.toApprove).filter((t) => ids.includes(t.id));
      let done = 0;
      const ok = await esign({
        title: kind === 'review' ? `Sign review for ${plural(ids.length, 'test')}` : `Approve ${plural(ids.length, 'test')}`,
        meaning: kind === 'review' ? 'Reviewed — results verified against raw data' : 'Approved for release',
        description: html`<p style="margin:0 0 6px">Your signature is applied to each of these records:</p><ul style="margin:0;padding-left:18px">${list.map((t) => html`<li><span class="code">${t.code}</span> ${t.method_code} · ${t.sample_code}</li>`)}</ul>`,
        confirmLabel: kind === 'review' ? 'Sign all' : 'Approve all',
        onSign: async (sig) => {
          for (const id of ids.slice(done)) {
            await api.post(`/api/tests/${id}/${kind}`, { ...sig, decision: 'approve' });
            done++;
          }
        },
      });
      if (ok || done) {
        toast(`${plural(done, 'test')} ${kind === 'review' ? 'reviewed' : 'approved'}`);
        refreshNav();
        ctx.refresh();
      }
      return;
    }
    const issue = e.target.closest('[data-issue]');
    if (issue) {
      const ok = await esign({
        title: `Issue certificate for ${issue.dataset.code}`,
        meaning: 'Certificate of Analysis issued',
        confirmLabel: 'Sign & issue',
        onSign: (sig) => api.post(`/api/samples/${issue.dataset.issue}/report`, sig),
      });
      if (ok) {
        toast('Certificate issued');
        refreshNav();
        ctx.refresh();
      }
    }
  });
}
