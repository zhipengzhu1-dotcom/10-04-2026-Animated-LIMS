import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery, refreshNav } from '../core/nav.js';
import { markdown } from '../core/markdown.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, statusBadge, fmtDateTime, relTime, emptyState, field, openForm, esign, toast,
  showError, person, debounce, fmtTime,
} from '../core/ui.js';
import { signatureList, recordFooter, wireRecordFooter } from '../core/components.js';
import { documentsCard, mountDocuments, DOC_TEMPLATES } from './notebook-documents.js';

export const TEMPLATES = {
  blank: { label: 'Blank page', body: '' },
  experiment: {
    label: 'Experiment',
    body: '## Objective\n\n\n## Materials & equipment\n- Instrument: \n- Standards / reagents (code, lot): \n\n## Procedure\n1. \n\n## Results\n| Sample | Replicate | Result | Unit |\n|---|---|---|---|\n|  |  |  |  |\n\n## Observations\n\n\n## Conclusion\n',
  },
  prep: {
    label: 'Standard / solution preparation',
    body: '## Solution\nName: \nIntended use: \n\n## Materials\n| Material | Code | Lot | Potency | Amount |\n|---|---|---|---|---|\n|  |  |  |  |  |\n\n## Preparation\n- Balance: \n- Weight taken: \n- Final volume / diluent: \n- Concentration: \n\n## Storage & expiry\nStore at: \nExpires: \n',
  },
  devexp: {
    label: 'Method development experiment',
    body: '## Aim\n\n\n## Conditions tested\n| Run | Column | Mobile phase | Gradient | Flow | Temp |\n|---|---|---|---|---|---|\n| 1 |  |  |  |  |  |\n\n## Results\n| Run | Resolution (critical pair) | Tailing | Plate count | Comment |\n|---|---|---|---|---|\n| 1 |  |  |  |  |\n\n## Decision / next step\n',
  },
  validation: {
    label: 'Validation parameter',
    body: '## Parameter\n(e.g. Linearity, Accuracy, Precision, Specificity, Robustness)\n\n## Protocol reference\n\n\n## Acceptance criteria\n\n\n## Data\n| Level | Replicate | Result | Recovery / RSD |\n|---|---|---|---|\n|  |  |  |  |\n\n## Evaluation\n\n\n**Meets acceptance criteria:** Yes / No\n',
  },
  troubleshooting: {
    label: 'Instrument troubleshooting',
    body: '## Instrument\nCode: \n\n## Symptom\n\n\n## Checks performed\n1. \n\n## Outcome\n\n\n## Impact on results\n',
  },
};

export async function newEntry(prefill = {}) {
  const [projects, methods] = await Promise.all([api.get('/api/projects', { status: 'open' }), api.get('/api/methods')]);
  const id = await openForm({
    title: 'New notebook entry',
    size: 'lg',
    submitLabel: 'Create entry',
    body: html`
      ${field({ label: 'Title', name: 'title', value: prefill.title, required: true, span: 2, autofocus: true, placeholder: 'What is this entry about?' })}
      ${field({ label: 'Template', name: 'template', type: 'select', options: Object.entries(TEMPLATES).map(([k, t]) => [k, t.label]), value: prefill.template || 'experiment' })}
      ${field({ label: 'Tags', name: 'tags', placeholder: 'comma, separated' })}
      ${field({ label: 'Also start a document', name: 'document', type: 'select', options: DOC_TEMPLATES.map(([k, label]) => [k, label]), empty: 'No — text only', span: 2, hint: 'Opens in desktop Word or Excel; every save is versioned in the entry.' })}
      ${field({ label: 'Project', name: 'project_id', type: 'select', options: projects.map((p) => [p.id, `${p.code} — ${p.title}`]), value: prefill.project_id, empty: 'None' })}
      ${field({ label: 'Method', name: 'method_id', type: 'select', options: methods.map((m) => [m.id, `${m.code} v${m.version} — ${m.title}`]), value: prefill.method_id, empty: 'None' })}
      <input type="hidden" name="sample_id" value="${prefill.sample_id || ''}">`,
    onSubmit: async (d) => {
      const res = await api.post('/api/notebook', { title: d.title, tags: d.tags, project_id: d.project_id || null, method_id: d.method_id || null, sample_id: d.sample_id || null, body: TEMPLATES[d.template]?.body || '' });
      if (d.document) await api.post(`/api/notebook/${res.id}/documents`, { template: d.document }).catch(showError);
      return res.id;
    },
  });
  if (id) navigate(`/notebook/${id}`);
}

export async function list(ctx) {
  ctx.title('Lab notebook');
  const view = ctx.query.view || 'all';
  const params = {};
  if (view === 'mine') params.mine = 1;
  if (view === 'drafts') { params.mine = 1; params.status = 'Draft'; }
  if (view === 'signed') params.status = 'Signed';
  const rows = await api.get('/api/notebook', params);
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Lab notebook',
      sub: 'Electronic notebook entries — signed by the author, witnessed by a colleague, never overwritten.',
      actions: can('notebook.write') ? html`<button class="btn primary" data-act="new">${icon('plus', { size: 15 })}New entry</button>` : '',
    })}
    <div class="toolbar">
      ${segmented([
        { key: 'all', label: 'All entries', href: setQuery({ view: null }) },
        { key: 'mine', label: 'Mine', href: setQuery({ view: 'mine' }) },
        { key: 'drafts', label: 'My drafts', href: setQuery({ view: 'drafts' }) },
        { key: 'signed', label: 'Awaiting witness', href: setQuery({ view: 'signed' }) },
      ], view)}
      <span class="spacer"></span>
      ${searchBox('Search titles, tags, text…')}
    </div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows,
    rowHref: (r) => `/notebook/${r.id}`,
    sort: { key: 'updated_at', dir: -1 },
    searchText: (r) => `${r.code} ${r.title} ${r.tags} ${r.excerpt} ${r.author_name} ${r.project_code}`,
    empty: emptyState({ icon: 'book', title: 'No entries', text: 'Start your first electronic notebook entry.', action: can('notebook.write') ? html`<button class="btn primary" data-act="new">New entry</button>` : '' }),
    columns: [
      { key: 'title', label: 'Entry', sort: true, cls: 'title-cell', render: (r) => html`<a href="/notebook/${r.id}"><strong>${r.title}</strong></a>${r.doc_count ? html` <span class="doc-count" title="${r.doc_count} Word/Excel document${r.doc_count > 1 ? 's' : ''}">${icon('method', { size: 11 })}${r.doc_count}</span>` : ''}<span class="sub-line"><span class="code" style="font-size:11.5px">${r.code}</span> · ${r.excerpt?.replace(/[#*|_`>-]/g, ' ').replace(/\s+/g, ' ').slice(0, 120)}</span>` },
      { key: 'author_name', label: 'Author', sort: true, render: (r) => person(r.author_name, r.author_id, r.author_initials) },
      { key: 'project_code', label: 'Project', sort: true, render: (r) => (r.project_code ? html`<a href="/projects/${r.project_id}" class="code">${r.project_code}</a>` : html`<span class="muted">—</span>`) },
      { key: 'tags', label: 'Tags', render: (r) => (r.tags ? r.tags.split(',').map((t) => html`<span class="tag">${t.trim()}</span>`) : '') },
      { key: 'status', label: 'Status', sort: true, render: (r) => statusBadge(r.status) },
      { key: 'updated_at', label: 'Updated', sort: true, render: (r) => html`<span class="nowrap muted">${relTime(r.updated_at)}</span>` },
    ],
  });
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
  ctx.el.addEventListener('click', (e) => { if (e.target.closest('[data-act=new]')) newEntry(); });
}

export async function detail(ctx) {
  const d = await api.get(`/api/notebook/${ctx.params.id}`);
  const n = d.entry;
  ctx.title(n.code);
  const editing = d.can.edit;

  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/notebook', label: 'Lab notebook' },
      title: editing ? html`<input class="title-input" data-title value="${n.title}" aria-label="Title">` : n.title,
      badges: statusBadge(n.status),
      meta: html`<span class="code">${n.code}</span><span>${icon('user', { size: 14 })}${n.author_name}</span><span>${icon('clock', { size: 14 })}Created ${fmtDateTime(n.created_at)}</span>${n.tags ? html`<span>${n.tags.split(',').map((t) => html`<span class="tag">${t.trim()}</span>`)}</span>` : ''}`,
      actions: html`
        ${d.can.sign ? html`<button class="btn primary" data-act="sign">${icon('sign', { size: 15 })}Sign & lock</button>` : ''}
        ${d.can.witness ? html`<button class="btn primary" data-act="witness">${icon('sign', { size: 15 })}Witness</button>` : ''}
        ${d.can.addendum ? html`<button class="btn" data-act="addendum">${icon('plus', { size: 15 })}Addendum</button>` : ''}
        <button class="btn" data-act="print">${icon('printer', { size: 15 })}Print</button>`,
    })}
    <div class="split">
      <div class="stack">
        ${editing ? card({
          body: html`
            <div class="editor-bar">
              <button class="btn sm" data-ins="h">${icon('method', { size: 13 })}Heading</button>
              <button class="btn sm" data-ins="table">Table</button>
              <button class="btn sm" data-ins="list">List</button>
              <button class="btn sm" data-ins="bold"><strong>B</strong></button>
              <button class="btn sm" data-ins="stamp">${icon('clock', { size: 13 })}Timestamp</button>
              <span class="spacer"></span>
              <span class="save-state" data-save-state>All changes saved</span>
            </div>
            <div class="editor"><textarea data-body spellcheck="true" aria-label="Entry text">${n.body}</textarea><div class="preview md" data-preview>${raw(markdown(n.body))}</div></div>
            <p class="muted small" style="margin:10px 0 0">${icon('lock', { size: 12 })} Drafts save automatically. When the work is complete, sign the entry — it then becomes read-only and corrections are made as dated addenda.</p>`,
        }) : html`
          ${n.status !== 'Draft' ? html`<div class="locked-banner">${icon('lock', { size: 14 })}<span>Signed by ${n.author_name} on ${fmtDateTime(n.signed_at)}${n.witnessed_at ? html` · witnessed by ${n.witness_name} on ${fmtDateTime(n.witnessed_at)}` : ' · awaiting witness'}. This entry can no longer be changed.</span></div>` : ''}
          ${card({ body: html`<div class="md">${raw(markdown(n.body) || '<p class="muted">Empty entry</p>')}</div>
            ${d.addenda.map((a) => html`<div class="addendum"><header>${icon('plus', { size: 12 })} Addendum by <strong>${a.author_name}</strong> · ${fmtDateTime(a.created_at)}</header><div class="md">${raw(markdown(a.body))}</div></div>`)}` })}`}
        ${documentsCard({ docs: d.documents, editable: editing })}
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Entry details', body: kv([
          ['Author', person(n.author_name, n.author_id, n.author_initials)],
          ['Status', statusBadge(n.status)],
          ['Project', n.project_id ? html`<a href="/projects/${n.project_id}">${n.project_code}</a> <span class="muted small">${n.project_title}</span>` : null],
          ['Sample', n.sample_id ? html`<a href="/samples/${n.sample_id}">${n.sample_code}</a>` : null],
          ['Method', n.method_id ? html`<a href="/methods/${n.method_id}">${n.method_code} v${n.method_version}</a>` : null],
          ['Last edited', fmtDateTime(n.updated_at)],
        ]) })}
        ${card({ title: 'Signatures', body: signatureList(d.signatures) })}
      </div>
    </div>`);

  const docs = mountDocuments(ctx.el, n, { docs: d.documents, editable: editing, isCurrent: ctx.isCurrent, beforeOpen: () => ctx.flush?.() });
  wireRecordFooter(ctx.el, 'notebook_entries', n.id);

  if (editing) {
    const ta = ctx.el.querySelector('[data-body]');
    const preview = ctx.el.querySelector('[data-preview]');
    const stateEl = ctx.el.querySelector('[data-save-state]');
    let lastSaved = n.body;
    let saving = false;
    const save = async () => {
      if (saving || ta.value === lastSaved) return;
      saving = true;
      const value = ta.value;
      stateEl.textContent = 'Saving…';
      try {
        await api.put(`/api/notebook/${n.id}`, { body: value });
        lastSaved = value;
        stateEl.textContent = `Saved ${fmtTime(new Date())}`;
      } catch (e) {
        stateEl.textContent = 'Not saved';
        showError(e);
      } finally {
        saving = false;
        if (ta.value !== lastSaved) autosave();
      }
    };
    const autosave = debounce(save, 1200);
    ta.addEventListener('input', () => {
      preview.innerHTML = markdown(ta.value);
      stateEl.textContent = 'Editing…';
      autosave();
    });
    ta.addEventListener('blur', save);
    const titleInput = ctx.el.querySelector('[data-title]');
    titleInput.addEventListener('change', async () => {
      try { await api.put(`/api/notebook/${n.id}`, { title: titleInput.value }); toast('Title updated'); } catch (e) { showError(e); }
    });
    const insert = (text) => {
      const { selectionStart: a, selectionEnd: b, value } = ta;
      ta.value = value.slice(0, a) + text + value.slice(b);
      ta.selectionStart = ta.selectionEnd = a + text.length;
      ta.focus();
      ta.dispatchEvent(new Event('input'));
    };
    ctx.el.querySelector('.editor-bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ins]');
      if (!b) return;
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'text';
      ({
        h: () => insert('\n## Heading\n'),
        table: () => insert('\n| Column | Column | Column |\n|---|---|---|\n|  |  |  |\n'),
        list: () => insert('\n- \n- \n'),
        bold: () => insert(`**${sel}**`),
        stamp: () => insert(`\n_${new Date().toLocaleString()} — ${state.me.initials || state.me.full_name}_: `),
      })[b.dataset.ins]();
    });
    const guard = (e) => {
      if (!ctx.isCurrent()) return window.removeEventListener('beforeunload', guard);
      if (ta.value !== lastSaved) { e.preventDefault(); e.returnValue = ''; }
      return undefined;
    };
    window.addEventListener('beforeunload', guard);
    ctx.flush = save;
  }

  ctx.el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'print') window.print();
    if (act === 'sign') {
      await ctx.flush?.();
      await docs.refresh().catch(() => {});
      const signedDocs = docs.docs().filter((x) => !x.removed);
      const ok = await esign({
        title: 'Sign notebook entry',
        action: 'notebook.author',
        description: html`<p style="margin:0">Signing locks the entry permanently. Corrections afterwards can only be made as dated addenda.</p>
          ${signedDocs.length ? html`<div class="notice warn" style="margin-top:10px">${icon('lock', { size: 14 })}<span>These document versions are signed with it: ${signedDocs.map((x, i) => html`${i ? ', ' : ''}<strong>${x.filename}</strong> v${x.version}`)}. Save and close them in Word/Excel first — unsaved changes there are not included.</span></div>` : ''}`,
        confirmLabel: 'Sign & lock',
        onSign: (sig) => api.post(`/api/notebook/${n.id}/sign`, sig),
      });
      if (ok) { toast('Entry signed and locked'); refreshNav(); ctx.refresh(); }
    }
    if (act === 'witness') {
      const ok = await esign({
        title: 'Witness notebook entry',
        action: 'notebook.witness',
        description: html`You confirm you have read <strong>${n.code}</strong> by ${n.author_name} and that it is understandable and complete.`,
        confirmLabel: 'Sign as witness',
        comment: { label: 'Comment (optional)' },
        onSign: (sig) => api.post(`/api/notebook/${n.id}/witness`, sig),
      });
      if (ok) { toast('Entry witnessed'); refreshNav(); ctx.refresh(); }
    }
    if (act === 'addendum') {
      const ok = await openForm({
        title: 'Add addendum',
        size: 'lg',
        submitLabel: 'Add addendum',
        body: html`<p class="span-2 muted">The original entry stays unchanged. Your addendum is dated, attributed to you and shown below the entry.</p>
          ${field({ name: 'body', type: 'textarea', rows: 8, required: true, span: 2, autofocus: true, placeholder: 'e.g. Correction: the column lot used was 0213, not 0231 (see column log).' })}`,
        onSubmit: (dd) => api.post(`/api/notebook/${n.id}/addenda`, dd),
      });
      if (ok) { toast('Addendum added'); ctx.refresh(); }
    }
  });
}
