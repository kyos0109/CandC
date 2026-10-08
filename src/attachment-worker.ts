// Self-contained worker: Node 24 can run the source in tests; release builds use the emitted JS.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import yauzl from 'yauzl';

const MAX_TEXT = 100_000, MAX_EXPANDED = 100 * 1024 * 1024, MAX_ENTRIES = 10_000;
function check(text: string) { if (text.length > MAX_TEXT) throw new Error('ATTACHMENT_TEXT_LIMIT'); return text; }

async function checkArchive(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error || !zip) { reject(new Error('ATTACHMENT_INVALID')); return; }
    let entries = 0, expanded = 0;
    const fail = () => { zip.close(); reject(new Error('ATTACHMENT_ARCHIVE_LIMIT')); };
    zip.on('error', () => { zip.close(); reject(new Error('ATTACHMENT_INVALID')); });
    zip.on('end', resolve);
    zip.on('entry', entry => {
      if (++entries > MAX_ENTRIES || entry.generalPurposeBitFlag & 1 || entry.uncompressedSize > MAX_EXPANDED ||
        entry.fileName.startsWith('/') || entry.fileName.split('/').includes('..')) { fail(); return; }
      // Count actual inflated bytes, rather than trusting ZIP size headers.
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) { zip.close(); reject(new Error('ATTACHMENT_INVALID')); return; }
        stream.on('error', () => { zip.close(); reject(new Error('ATTACHMENT_INVALID')); });
        stream.on('data', chunk => { expanded += chunk.length; if (expanded > MAX_EXPANDED) { stream.destroy(); fail(); } });
        stream.on('end', () => zip.readEntry());
      });
    });
    zip.readEntry();
  }));
}

async function parse() {
  const bytes = await readFile(workerData.path as string), format = workerData.format as string;
  if (format === 'text') {
    let encoding = 'utf-8', offset = 0;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; offset = 2; }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; offset = 2; }
    let text: string;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)); }
    catch { throw new Error('ATTACHMENT_ENCODING'); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('ATTACHMENT_ENCODING');
    return check(text);
  }
  if (format === 'pdf') {
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('ATTACHMENT_INVALID');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false,
      disableFontFace: true, stopAtErrors: true });
    let text = '', hasText = false;
    try {
      const document = await task.promise;
      if (document.numPages > 2000) throw new Error('ATTACHMENT_TEXT_LIMIT');
      for (let page = 1; page <= document.numPages; page++) {
        const value = await document.getPage(page), content = await value.getTextContent();
        const lines = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
        hasText ||= !!lines.trim(); text = check(text + `[Page ${page}]\n${lines}\n`); value.cleanup();
      }
      return hasText ? text : '';
    } finally { await task.destroy(); }
  }
  await checkArchive(bytes);
  if (format === 'docx') {
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: bytes });
    return check(result.value);
  }
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  let text = '', hasText = false;
  workbook.eachSheet(sheet => {
    text = check(text + `[Worksheet ${sheet.name}${sheet.state === 'visible' ? '' : '; hidden'}]\n`);
    sheet.eachRow(row => row.eachCell(cell => {
      if (cell.value === null || cell.value === undefined) return;
      const value = cell.value;
      const content = typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)
        ? `formula=${cell.formula}; cached=${JSON.stringify(cell.result ?? null)}`
        : typeof value === 'object' && 'hyperlink' in value ? value.text : cell.text;
      if (content.trim()) hasText = true;
      text = check(text + `${cell.address}: ${content}\n`);
    }));
  });
  return hasText ? text : '';
}
try { const text = await parse(); if (!text.trim()) throw new Error('ATTACHMENT_EMPTY'); parentPort!.postMessage({ text }); }
catch (error) {
  const code = error instanceof Error && /^ATTACHMENT_[A-Z_]+$/.test(error.message) ? error.message : 'ATTACHMENT_INVALID';
  parentPort!.postMessage({ error: code });
}
