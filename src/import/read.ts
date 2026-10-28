import { strFromU8, unzipSync } from 'fflate';
import { ImportError } from './types';

/** 账单文件 → 二维表（字符串）。XLSX 读第一个工作表，CSV 自动识别 UTF-8 / GBK */
export function readTable(bytes: Uint8Array): string[][] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  return parseCsv(decodeText(bytes));
}

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    // 支付宝导出的 CSV 是 GBK
    return new TextDecoder('gbk').decode(bytes);
  }
}

/** RFC 4180 风格 CSV：支持引号、字段内逗号与换行、"" 转义 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------- 极简 XLSX ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e],
  );
}

/** 一个 <si> / <is> 中所有 <t> 文本拼接（富文本会拆成多个 <r><t>） */
function joinText(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name),
    });
  } catch {
    throw new ImportError('Excel 文件已损坏或不是有效的 xlsx');
  }
  const sheetName = Object.keys(files)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new ImportError('Excel 文件中没有工作表');

  const shared: string[] = [];
  const sst = files['xl/sharedStrings.xml'];
  if (sst) for (const m of strFromU8(sst).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(joinText(m[1]));

  const rows: string[][] = [];
  for (const rm of strFromU8(files[sheetName]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = joinText(body);
      else if (v !== undefined) value = decodeXml(v);
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push('');
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows;
}
