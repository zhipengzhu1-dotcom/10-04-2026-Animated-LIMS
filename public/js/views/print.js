// Printable documents (no app chrome): Certificate of Analysis, sample labels, invoices.
import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { icon } from '../core/icons.js';
import { barcodeSvg } from '../core/barcode.js';
import { fmtDate, fmtDateTime, specText, resultText, money } from '../core/ui.js';

function toolbar(back, label, extra = '') {
  return html`<div class="print-toolbar">
    <a class="btn ghost" href="${back}">${icon('arrowLeft', { size: 15 })}Back</a>
    <strong>${label}</strong><span class="spacer"></span>${extra}
    <button class="btn primary" data-print>${icon('printer', { size: 15 })}Print / Save as PDF</button>
  </div>`;
}

const letterhead = (lab, title, sub) => html`
  <div class="letterhead">
    <div><div class="lab-name">${lab.lab_name}</div><div class="lab-addr">${lab.lab_address}${lab.lab_phone ? `\n${lab.lab_phone}` : ''}${lab.lab_email ? ` · ${lab.lab_email}` : ''}</div>${lab.lab_accreditation ? html`<div class="lab-addr">${lab.lab_accreditation}</div>` : ''}</div>
    <div class="doc-title"><h1>${title}</h1>${sub}</div>
  </div>`;

export async function coa(ctx) {
  const d = await api.get(`/api/samples/${ctx.params.id}/coa`);
  const s = d.sample;
  ctx.title(`CoA ${s.code}`);
  const sig = (meaning) => d.tests.flatMap((t) => t.signatures.filter((g) => g.meaning === meaning));
  const names = (list) => [...new Set(list.map((g) => g.full_name))].join(', ');
  const issued = d.signatures.find((g) => g.meaning === 'Certificate of Analysis issued');
  const fails = d.tests.flatMap((t) => t.results).filter((r) => r.outcome === 'Fail');

  ctx.el.innerHTML = String(html`
    ${toolbar(`/samples/${s.id}`, `Certificate of Analysis · ${s.code}`, d.final ? '' : html`<span class="badge amber">Draft — not yet issued</span>`)}
    <div class="print-wrap"><div class="sheet">
      ${d.final ? '' : html`<div class="watermark">DRAFT</div>`}
      ${letterhead(d.lab, 'Certificate of Analysis', html`<small>No. COA-${s.code}</small><small>${issued ? `Issued ${fmtDate(issued.signed_at)}` : 'Not issued'}</small>`)}
      <table class="info"><tbody>
        <tr><td class="k">Client</td><td><strong>${s.client_name}</strong>${s.client_address ? html`<br><span style="white-space:pre-line;color:#555">${s.client_address}</span>` : ''}</td><td class="k">Laboratory sample no.</td><td><strong>${s.code}</strong><br>${raw(barcodeSvg(s.code, { height: 26, module: 1 }))}</td></tr>
        <tr><td class="k">Sample description</td><td>${s.description}</td><td class="k">Batch / lot</td><td><strong>${s.batch_no || '—'}</strong></td></tr>
        <tr><td class="k">Client reference</td><td>${s.client_ref || '—'}</td><td class="k">Sample type</td><td>${s.sample_type || '—'}</td></tr>
        <tr><td class="k">Project / PO</td><td>${s.project_code || '—'}${s.po_number ? ` · PO ${s.po_number}` : ''}</td><td class="k">Received</td><td>${fmtDate(s.received_at)} (${s.condition || 'Acceptable'})</td></tr>
        <tr><td class="k">Quantity / container</td><td>${[s.quantity, s.container].filter(Boolean).join(' · ') || '—'}</td><td class="k">Storage</td><td>${s.storage || '—'}</td></tr>
      </tbody></table>
      <table class="res">
        <thead><tr><th style="width:36%">Test / parameter</th><th>Specification</th><th style="text-align:right">Result</th><th>Conclusion</th></tr></thead>
        <tbody>${d.tests.map((t) => html`
          <tr class="method"><td colspan="4">${t.method_title} <span style="font-weight:400;color:#555">— ${t.method_code} v${t.method_version}${t.reference ? ` · ${t.reference}` : ''}${t.approved_at ? ` · approved ${fmtDate(t.approved_at)}` : ` · ${t.status}`}</span></td></tr>
          ${t.results.map((r) => html`<tr><td style="padding-left:14px">${r.analyte}</td><td>${specText(r)}</td><td class="num">${resultText(r)}</td><td class="${r.outcome === 'Fail' ? 'fail' : ''}">${r.outcome === 'Pass' ? 'Complies' : r.outcome === 'Fail' ? 'Does not comply' : r.outcome === 'Report' ? 'For information' : 'Pending'}</td></tr>`)}`)}
        </tbody>
      </table>
      <div class="conclusion ${d.complies ? '' : 'bad'}">${d.complies
        ? 'Conclusion: the sample complies with the specifications for all tests performed.'
        : fails.length ? `Conclusion: the sample DOES NOT COMPLY — ${fails.length} result${fails.length > 1 ? 's' : ''} outside specification (${fails.map((f) => f.analyte).join(', ')}).` : 'Conclusion: testing is not complete.'}</div>
      <p style="font-size:8.5pt;color:#555">Results relate to rounded values compared against the specification limits. Specifications as provided by the client. ${d.lab.coa_statement}</p>
      <div class="sigs">
        <div><span style="color:#555">Performed by</span><strong>${names(sig('Performed')) || '—'}</strong></div>
        <div><span style="color:#555">Reviewed by</span><strong>${names(sig('Reviewed')) || '—'}</strong></div>
        <div><span style="color:#555">Approved & issued by (QA)</span><strong>${issued ? issued.full_name : '—'}</strong>${issued ? html`<span style="color:#555">Electronically signed ${fmtDateTime(issued.signed_at)}</span>` : ''}</div>
      </div>
      <div class="foot"><span>${d.lab.lab_name} · COA-${s.code}</span><span>This document was electronically signed and is valid without a handwritten signature.</span></div>
    </div></div>`);
  ctx.el.querySelector('[data-print]').addEventListener('click', () => {
    api.post(`/api/samples/${s.id}/coa-printed`).catch(() => {});
    window.print();
  });
}

export async function labels(ctx) {
  const ids = ctx.query.ids || '';
  const rows = await api.get('/api/samples/labels', { ids });
  ctx.title('Sample labels');
  const copies = Math.max(1, Math.min(10, Number(ctx.query.copies) || 1));
  const all = rows.flatMap((r) => Array.from({ length: copies }, () => r));
  ctx.el.innerHTML = String(html`
    ${toolbar(rows.length === 1 ? `/samples/${rows[0].id}` : '/samples', `${all.length} label${all.length === 1 ? '' : 's'} · A4, 3 × 7 (63.5 × 38.1 mm)`, html`<label class="row small">Copies each <select data-copies style="width:70px;height:30px">${[1, 2, 3, 4, 5].map((n) => html`<option ${n === copies ? raw('selected') : ''}>${n}</option>`)}</select></label>`)}
    <div class="print-wrap"><div class="labels-sheet">${all.map((s) => html`
      <div class="print-label">
        <div class="l-row"><span class="l-code">${s.code}</span><span>${s.client_code}</span></div>
        <div class="l-desc">${s.description}</div>
        ${raw(barcodeSvg(s.code, { height: 34, module: 1 }))}
        <div class="l-row"><span>${s.batch_no ? `Batch ${s.batch_no}` : ''}</span><span class="${s.priority !== 'Standard' ? 'l-prio' : ''}">${s.priority !== 'Standard' ? s.priority.toUpperCase() : ''}</span></div>
        <div class="l-row"><span>Rec. ${fmtDate(s.received_at)}</span><span>${(s.storage || '').replace(/\s*\(.*\)/, '')}</span></div>
      </div>`)}</div></div>`);
  ctx.el.querySelector('[data-print]').addEventListener('click', () => window.print());
  ctx.el.querySelector('[data-copies]').addEventListener('change', (e) => {
    history.replaceState({}, '', `/print/labels?ids=${ids}&copies=${e.target.value}`);
    ctx.refresh();
  });
}

export async function invoice(ctx) {
  const [d, L] = await Promise.all([api.get(`/api/invoices/${ctx.params.id}`), api.get('/api/settings')]);
  const inv = d.invoice;
  ctx.title(inv.code);
  ctx.el.innerHTML = String(html`
    ${toolbar(`/invoices/${inv.id}`, `Invoice ${inv.code}`, inv.status === 'Draft' ? html`<span class="badge amber">Draft</span>` : '')}
    <div class="print-wrap"><div class="sheet">
      ${inv.status === 'Draft' ? html`<div class="watermark">DRAFT</div>` : inv.status === 'Void' ? html`<div class="watermark">VOID</div>` : ''}
      ${letterhead(L, 'Invoice', html`<small>No. ${inv.code}</small><small>${inv.issued_date ? `Date ${fmtDate(inv.issued_date)}` : 'Not issued'}</small>${inv.due_date ? html`<small>Payment due ${fmtDate(inv.due_date)}</small>` : ''}`)}
      <table class="info"><tbody>
        <tr><td class="k">Bill to</td><td><strong>${inv.client_name}</strong>${inv.contact_name ? html`<br>Attn: ${inv.contact_name}` : ''}<br><span style="white-space:pre-line;color:#555">${inv.client_address || ''}</span></td>
          <td class="k">Project</td><td>${inv.project_code ? html`${inv.project_code}<br><span style="color:#555">${inv.project_title}</span>` : '—'}${inv.po_number ? html`<br>PO <strong>${inv.po_number}</strong>` : ''}</td></tr>
      </tbody></table>
      <table class="res">
        <thead><tr><th>Description</th><th style="text-align:right;width:12%">Qty</th><th style="text-align:right;width:16%">Unit price</th><th style="text-align:right;width:16%">Amount</th></tr></thead>
        <tbody>${d.lines.map((l) => html`<tr><td>${l.description}</td><td class="num">${l.quantity}</td><td class="num">${money(l.unit_price)}</td><td class="num">${money(l.quantity * l.unit_price)}</td></tr>`)}
          <tr><td colspan="3" class="num" style="border:0">Subtotal</td><td class="num" style="border:0">${money(d.totals.subtotal)}</td></tr>
          <tr><td colspan="3" class="num" style="border:0">Tax (${inv.tax_rate}%)</td><td class="num" style="border:0">${money(d.totals.tax)}</td></tr>
          <tr><td colspan="3" class="num" style="border:0"><strong>Total due (${state.settings.currency})</strong></td><td class="num" style="border:0"><strong>${money(d.totals.total)}</strong></td></tr>
        </tbody>
      </table>
      ${inv.notes ? html`<p>${inv.notes}</p>` : ''}
      <p style="font-size:9pt;color:#555">Please quote ${inv.code} with your payment. Certificates of Analysis for the samples listed are available on request.</p>
      <div class="foot"><span>${L.lab_name}</span><span>${inv.code}</span></div>
    </div></div>`);
  ctx.el.querySelector('[data-print]').addEventListener('click', () => window.print());
}
