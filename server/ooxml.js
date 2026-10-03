// Word (.docx) and Excel (.xlsx) files without dependencies: both are ZIP archives of XML parts, so this
// module has a small ZIP reader/writer (node:zlib does the compression), generators for new documents,
// a validator for uploads, and read-only previews (text + tables for Word, a cell grid for Excel).

import zlib from 'node:zlib';
import { HttpError } from './http.js';

export const KINDS = {
  docx: { label: 'Word document', app: 'Word', scheme: 'ms-word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', main: 'word/document.xml' },
  xlsx: { label: 'Excel workbook', app: 'Excel', scheme: 'ms-excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', main: 'xl/workbook.xml' },
};

export const kindOf = (filename) => {
  const ext = String(filename || '').toLowerCase().match(/\.([a-z]+)$/)?.[1];
  return KINDS[ext] ? ext : null;
};

// ---------------------------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------------------------

const MAX_ENTRY_BYTES = 64 * 1024 * 1024; // guards previews against "zip bombs"

function dosDateTime(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** files: [[name, string | Buffer]] → Buffer (deflate, UTF-8 names). */
export function zip(files) {
  const { time, date } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Opens a ZIP archive. Returns { names, has(name), text(name) } or throws a 400 if it isn't one. */
export function unzip(buf) {
  const notZip = () => new HttpError(400, 'This is not a valid Word or Excel file');
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw notZip();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw notZip();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw notZip();
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const n = buf.readUInt16LE(p + 28);
    const m = buf.readUInt16LE(p + 30);
    const k = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + n);
    entries.set(name, { method, csize, usize, local });
    p += 46 + n + m + k;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.usize > MAX_ENTRY_BYTES) throw new HttpError(400, 'The file is too large to preview');
    if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw notZip();
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) {
      try {
        return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch {
        throw notZip();
      }
    }
    throw new HttpError(400, 'The file uses an unsupported compression method');
  };
  return { names: [...entries.keys()], has: (name) => entries.has(name), text: (name) => read(name)?.toString('utf8') ?? null };
}

/** Checks an uploaded file really is a macro-free Word/Excel file of the expected kind. */
export function inspectOffice(buf, kind) {
  const z = unzip(buf);
  if (!z.has('[Content_Types].xml') || !z.has(KINDS[kind].main)) {
    throw new HttpError(400, `This is not a valid ${KINDS[kind].label} (.${kind}). Save it from ${KINDS[kind].app} as .${kind} and try again.`);
  }
  if (z.names.some((n) => /vbaProject\.bin$/i.test(n))) throw new HttpError(400, 'Files containing macros are not accepted');
  return z;
}

// ---------------------------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------------------------

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') {
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  }
  return ENTITIES[e] ?? m;
});

/** Minimal streaming XML scanner: calls open(name, attrs, selfClosing), close(name), text(str). */
function scan(xml, { open, close, text }) {
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!(?:[^>]*)>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) text?.(m[1]);
    else if (m[3]) {
      if (m[2]) close?.(m[3]);
      else {
        const attrs = {};
        if (m[4]) for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescapeXml(a[2] ?? a[3]);
        open?.(m[3], attrs, !!m[5]);
        if (m[5]) close?.(m[3]);
      }
    } else if (m[6] !== undefined) text?.(unescapeXml(m[6]));
  }
}

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const CORE = (title, creator) => {
  const t = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>${xmlEsc(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${t}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${t}</dcterms:modified></cp:coreProperties>`;
};
const ROOT_RELS = (main) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

/**
 * Word document from simple blocks: { heading, level } | { p, muted } | { table: [[cell]] } (first row = header).
 */
export function makeDocx({ title = '', creator = '', blocks = [] }) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const run = (text, { bold, color } = {}) => {
    const lines = String(text ?? '').split('\n');
    const rpr = bold || color ? `<w:rPr>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr>` : '';
    return `<w:r>${rpr}${lines.map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(l)}</w:t>`).join('')}</w:r>`;
  };
  const para = (text, style, opts) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${text ? run(text, opts) : ''}</w:p>`;
  const body = blocks.map((b) => {
    if (b.heading !== undefined) return para(b.heading, b.level === 0 ? 'Title' : `Heading${b.level || 1}`);
    if (b.table) {
      const cols = Math.max(...b.table.map((r) => r.length));
      const grid = `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(cols)}</w:tblGrid>`;
      const rows = b.table.map((r, i) => `<w:tr>${Array.from({ length: cols }, (_, c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(r[c] ?? '', null, { bold: i === 0 })}</w:tc>`).join('')}</w:tr>`).join('');
      return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${rows}</w:tbl><w:p/>`;
    }
    return para(b.p ?? '', null, { color: b.muted ? '667085' : null });
  }).join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body || '<w:p/>'}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const heading = (id, name, size, before) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="80"/><w:outlineLvl w:val="${id === 'Title' ? 0 : Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="0F766E"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading('Title', 'Title', 36, 0)}${heading('Heading1', 'heading 1', 28, 240)}${heading('Heading2', 'heading 2', 24, 200)}${heading('Heading3', 'heading 3', 22, 160)}<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A0A7B4"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A0A7B4"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A0A7B4"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A0A7B4"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A0A7B4"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A0A7B4"/></w:tblBorders></w:tblPr></w:style></w:styles>`;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', ROOT_RELS('word/document.xml')],
    ['docProps/core.xml', CORE(title, creator)],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['word/document.xml', document],
    ['word/styles.xml', styles],
  ]);
}

const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const safeSheetName = (s, i) => String(s || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Sheet${i + 1}`;

/**
 * Excel workbook. sheets: [{ name, cols: [width], rows: [[cell]] }] where a cell is a string, a number,
 * null, or { v, f, b } (value, formula without "=", bold). Formulas are recalculated when Excel opens the file.
 */
// Functions added after Excel 2007 are stored with an _xlfn. prefix; without it Excel shows #NAME?.
const FUTURE_FNS = ['STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'QUARTILE.INC', 'QUARTILE.EXC', 'MODE.SNGL', 'NORM.DIST', 'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV', 'T.DIST', 'T.DIST.2T', 'T.INV', 'T.INV.2T', 'T.TEST', 'F.DIST', 'F.INV', 'F.TEST', 'CHISQ.TEST', 'CONFIDENCE.T', 'CONFIDENCE.NORM', 'RANK.EQ', 'RANK.AVG', 'CONCAT', 'TEXTJOIN', 'IFS', 'MAXIFS', 'MINIFS', 'SWITCH', 'XLOOKUP', 'XMATCH', 'IFNA', 'DAYS', 'ISOWEEKNUM'];
const FUTURE_RE = new RegExp(`(?<![\\w.])(${FUTURE_FNS.map((f) => f.replace(/\./g, '\\.')).join('|')})(?=\\s*\\()`, 'gi');
const futureFns = (f) => String(f).replace(FUTURE_RE, (m) => `_xlfn.${m.toUpperCase()}`);

export function makeXlsx({ title = '', creator = '', sheets }) {
  const sheetXml = (s) => {
    const cols = s.cols?.length ? `<cols>${s.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const rows = (s.rows || []).map((row, r) => {
      const cells = row.map((cell, c) => {
        if (cell == null || cell === '') return '';
        const o = typeof cell === 'object' ? cell : { v: cell };
        const ref = `${colName(c)}${r + 1}`;
        const style = o.b ? ' s="1"' : o.pct ? ' s="2"' : o.dp != null ? ` s="${3 + Math.min(Math.max(o.dp, 0), 4)}"` : '';
        if (o.f) {
          // v alongside f is the cached result, shown by viewers that don't recalculate; Excel recalculates on open.
          const cached = typeof o.v === 'number' && Number.isFinite(o.v) ? `<v>${o.v}</v>` : typeof o.v === 'string' ? `<v>${xmlEsc(o.v)}</v>` : '';
          return `<c r="${ref}"${style}${typeof o.v === 'string' ? ' t="str"' : ''}><f>${xmlEsc(futureFns(o.f))}</f>${cached}</c>`;
        }
        if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}"${style}><v>${o.v}</v></c>`;
        return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(o.v)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${cols}<sheetData>${rows}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  };
  const names = sheets.map((s, i) => safeSheetName(s.name, i));
  // cellXfs: 0 normal · 1 bold · 2 percent (0.0 %) · 3–7 fixed 0–4 decimals
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="5"><numFmt numFmtId="164" formatCode="0"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="0.00"/><numFmt numFmtId="167" formatCode="0.000"/><numFmt numFmtId="168" formatCode="0.0000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>${[164, 165, 166, 167, 168].map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', ROOT_RELS('xl/workbook.xml')],
    ['docProps/core.xml', CORE(title, creator)],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Previews (read-only, plain data — the browser renders them with escaping)
// ---------------------------------------------------------------------------------------------

const PREVIEW_BLOCKS = 1500;
const PREVIEW_ROWS = 400;
const PREVIEW_COLS = 40;

/** → { blocks: [{ type: 'h', level, text } | { type: 'p', text, list } | { type: 'table', rows }], truncated } */
export function previewDocx(buf) {
  const xml = inspectOffice(buf, 'docx').text('word/document.xml');
  const blocks = [];
  const tables = []; // stack of { rows, row, cell }
  let p = null;
  let inText = false;
  let inPPr = false;
  scan(xml, {
    open(name, a) {
      if (name === 'w:p') p = { text: '', style: null, list: false };
      else if (name === 'w:pPr') inPPr = true;
      else if (name === 'w:pStyle' && p && inPPr) p.style = a['w:val'] || null;
      else if (name === 'w:numPr' && p && inPPr) p.list = true;
      else if (name === 'w:t') inText = true;
      else if (name === 'w:tab' && p && !inPPr) p.text += '\t';
      else if ((name === 'w:br' || name === 'w:cr') && p) p.text += '\n';
      else if (name === 'w:tbl') tables.push({ rows: [], row: null, cell: null });
      else if (name === 'w:tr' && tables.length) tables.at(-1).row = [];
      else if (name === 'w:tc' && tables.length) tables.at(-1).cell = [];
    },
    close(name) {
      if (name === 'w:t') inText = false;
      else if (name === 'w:pPr') inPPr = false;
      else if (name === 'w:p' && p) {
        const t = tables.at(-1);
        if (t?.cell) t.cell.push(p.text);
        else if (blocks.length < PREVIEW_BLOCKS) {
          const h = /^(?:Heading|heading)\s?(\d)$/.exec(p.style || '') || (p.style === 'Title' ? [0, '0'] : null);
          if (h) blocks.push({ type: 'h', level: Number(h[1]), text: p.text });
          else blocks.push({ type: 'p', text: p.text, list: p.list || /^List/.test(p.style || '') });
        }
        p = null;
      } else if (name === 'w:tc' && tables.length) {
        const t = tables.at(-1);
        t.row?.push((t.cell || []).join('\n'));
        t.cell = null;
      } else if (name === 'w:tr' && tables.length) {
        const t = tables.at(-1);
        if (t.row) t.rows.push(t.row);
        t.row = null;
      } else if (name === 'w:tbl' && tables.length) {
        const t = tables.pop();
        const parent = tables.at(-1);
        if (parent?.cell) parent.cell.push(t.rows.map((r) => r.join(' | ')).join('\n')); // nested table: flatten into the cell
        else if (blocks.length < PREVIEW_BLOCKS) blocks.push({ type: 'table', rows: t.rows });
      }
    },
    text(s) { if (inText && p) p.text += s; },
  });
  // Collapse runs of empty paragraphs so the preview stays compact.
  const out = blocks.filter((b, i) => !(b.type === 'p' && !b.text.trim() && (i === 0 || (blocks[i - 1].type === 'p' && !blocks[i - 1].text.trim()))));
  return { blocks: out, truncated: blocks.length >= PREVIEW_BLOCKS };
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const BUILTIN_DECIMALS = { 1: 0, 2: 2, 3: 0, 4: 2, 9: 0, 10: 2 };

function formatNumber(v, fmt) {
  if (!Number.isFinite(v)) return String(v);
  if (fmt?.date) {
    // Excel serial date (1900 system; the 1904 system is handled by the caller's offset).
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return String(v);
    const iso = d.toISOString();
    const hasTime = fmt.time && Math.abs(v % 1) > 1e-9;
    return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
  }
  if (fmt?.percent) return `${(v * 100).toFixed(fmt.decimals ?? 0)} %`;
  if (fmt?.decimals != null) return v.toFixed(fmt.decimals);
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(10)));
}

function numberFormats(stylesXml) {
  if (!stylesXml) return [];
  const custom = {};
  const xfs = [];
  let inXfs = false;
  scan(stylesXml, {
    open(name, a) {
      if (name === 'numFmt') custom[a.numFmtId] = a.formatCode || '';
      else if (name === 'cellXfs') inXfs = true;
      else if (name === 'xf' && inXfs) xfs.push(Number(a.numFmtId || 0));
    },
    close(name) { if (name === 'cellXfs') inXfs = false; },
  });
  return xfs.map((id) => {
    if (BUILTIN_DATE_FORMATS.has(id)) return { date: true, time: id >= 18 && id !== 14 };
    if (id in BUILTIN_DECIMALS) return { decimals: BUILTIN_DECIMALS[id], percent: id === 9 || id === 10 };
    const code = custom[id];
    if (!code) return null;
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''); // drop literals, colours, conditions
    if (/[dmyhs]/i.test(bare) && !/0/.test(bare.split(';')[0])) return { date: true, time: /[hs]/i.test(bare) };
    const first = bare.split(';')[0];
    const dec = /\.(0+)/.exec(first);
    return { decimals: dec ? dec[1].length : (/0/.test(first) ? 0 : null), percent: /%/.test(first) };
  });
}

/** → { sheets: [{ name, rows: [[text]], merges: ['A1:C1'], truncated }] } — cached values, as Excel last calculated them. */
export function previewXlsx(buf) {
  const z = inspectOffice(buf, 'xlsx');
  const sheets = [];
  let date1904 = false;
  scan(z.text('xl/workbook.xml') || '', {
    open(name, a) {
      if (name === 'sheet' && a.state !== 'hidden' && a.state !== 'veryHidden') sheets.push({ name: a.name, rid: a['r:id'] });
      if (name === 'workbookPr' && (a.date1904 === '1' || a.date1904 === 'true')) date1904 = true;
    },
  });
  const targets = {};
  scan(z.text('xl/_rels/workbook.xml.rels') || '', {
    open(name, a) {
      if (name === 'Relationship') targets[a.Id] = a.Target?.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`;
    },
  });
  const shared = [];
  const ssXml = z.text('xl/sharedStrings.xml');
  if (ssXml) {
    let cur = null;
    let inT = false;
    let inPhonetic = false;
    scan(ssXml, {
      open(name) {
        if (name === 'si') cur = '';
        else if (name === 't') inT = true;
        else if (name === 'rPh') inPhonetic = true;
      },
      close(name) {
        if (name === 'si') { shared.push(cur); cur = null; }
        else if (name === 't') inT = false;
        else if (name === 'rPh') inPhonetic = false;
      },
      text(s) { if (inT && !inPhonetic && cur !== null) cur += s; },
    });
  }
  const formats = numberFormats(z.text('xl/styles.xml'));

  return {
    sheets: sheets.slice(0, 30).map((sh) => {
      const xml = z.text(targets[sh.rid] || '') || '';
      const cells = new Map();
      const merges = [];
      let maxR = 0;
      let maxC = 0;
      let truncated = false;
      let c = null;
      let field = null;
      let rowIdx = 0;
      let colIdx = -1;
      scan(xml, {
        open(name, a) {
          if (name === 'row') { rowIdx = a.r ? Number(a.r) - 1 : rowIdx + 1; colIdx = -1; }
          else if (name === 'c') {
            const m = /^([A-Z]+)(\d+)$/.exec(a.r || '');
            colIdx = m ? colIndex(m[1]) : colIdx + 1;
            c = { r: m ? Number(m[2]) - 1 : rowIdx, c: colIdx, t: a.t || 'n', s: Number(a.s || 0), v: '', f: '', is: '' };
          } else if (c && (name === 'v' || name === 'f' || name === 't')) field = name === 't' ? 'is' : name;
          else if (name === 'mergeCell' && a.ref) merges.push(a.ref);
        },
        close(name) {
          if (name === 'v' || name === 'f' || name === 't') field = null;
          else if (name === 'c' && c) {
            if (c.r >= PREVIEW_ROWS || c.c >= PREVIEW_COLS) truncated = true;
            else {
              let text;
              if (c.t === 's') text = shared[Number(c.v)] ?? '';
              else if (c.t === 'inlineStr') text = c.is;
              else if (c.t === 'str' || c.t === 'e' || c.t === 'd') text = c.v;
              else if (c.t === 'b') text = c.v === '1' ? 'TRUE' : c.v === '0' ? 'FALSE' : c.v;
              else if (c.v !== '') {
                const fmt = formats[c.s];
                text = formatNumber(Number(c.v) + (date1904 && fmt?.date ? 1462 : 0), fmt);
              } else text = c.f ? `=${c.f.replace(/_xlfn\./g, '')}` : '';
              if (text !== '') {
                cells.set(`${c.r},${c.c}`, text);
                maxR = Math.max(maxR, c.r + 1);
                maxC = Math.max(maxC, c.c + 1);
              }
            }
            c = null;
          }
        },
        text(s) { if (c && field) c[field] += s; },
      });
      const rows = Array.from({ length: maxR }, (_, r) => Array.from({ length: maxC }, (_, k) => cells.get(`${r},${k}`) ?? ''));
      return { name: sh.name, rows, merges: merges.slice(0, 500), truncated };
    }),
  };
}

export const preview = (buf, kind) => (kind === 'docx' ? previewDocx(buf) : previewXlsx(buf));
