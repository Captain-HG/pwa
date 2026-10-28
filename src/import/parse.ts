import { yuanToFen } from '@/domain/money';
import { ImportError, type BillRow, type BillSource, type ParsedBill } from './types';

const HOUR = 3_600_000;

/** 单元格清理：去首尾空白与制表符；「/」视为空 */
const clean = (s: string | undefined) => {
  const v = (s ?? '').replace(/^[\s\t]+|[\s\t]+$/g, '');
  return v === '/' ? '' : v;
};

/** 金额 → 分。字符串按分精确解析；浮点表示的数字（如 12.340000000000002）四舍五入 */
export function parseAmountFen(raw: string): number {
  const s = clean(raw).replace(/[¥￥,\s]/g, '');
  if (/^\d+(\.\d{1,2})?$/.test(s)) return yuanToFen(s);
  const n = Number(s);
  return s !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/** 北京时间字符串 YYYY-MM-DD HH:mm:ss → 时间戳 */
export function parseBeijingTime(s: string): number {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(clean(s));
  if (!m) return NaN;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, se || 0) - 8 * HOUR;
}

/** Excel 日期序列数（UTC+8）→ 时间戳，精确到秒 */
export function excelSerialToTime(serial: number): number {
  return Math.round(((serial - 25569) * 86400 - 8 * 3600)) * 1000;
}

function parseTime(raw: string): number {
  const s = clean(raw);
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToTime(Number(s));
  return parseBeijingTime(s);
}

interface Table {
  header: string[];
  rows: string[][];
}

function locate(table: string[][]): Table {
  const hi = table.findIndex((r) => r.some((c) => clean(c) === '交易时间') && r.some((c) => clean(c) === '收/支'));
  if (hi < 0) throw new ImportError('无法识别的账单文件：没有找到「交易时间」「收/支」表头');
  const header = table[hi].map((c) => clean(c));
  const rows = table.slice(hi + 1).filter((r) => r.some((c) => clean(c)) && clean(r[header.indexOf('交易时间')]));
  return { header, rows };
}

export function detectSource(header: string[]): BillSource {
  if (header.includes('交易订单号')) return 'alipay';
  if (header.includes('交易单号') && header.includes('当前状态')) return 'wechat';
  throw new ImportError('无法识别的账单文件：只支持支付宝和微信导出的账单');
}

function columns(header: string[], required: Record<string, string>, optional: Record<string, string>) {
  const idx: Record<string, number> = {};
  for (const [key, name] of Object.entries(required)) {
    const i = header.indexOf(name);
    if (i < 0) throw new ImportError(`账单缺少「${name}」列`);
    idx[key] = i;
  }
  for (const [key, name] of Object.entries(optional)) idx[key] = header.indexOf(name);
  return (r: string[], key: string) => (idx[key] >= 0 ? clean(r[idx[key]]) : '');
}

function direction(v: string): BillRow['direction'] {
  return v === '支出' ? 'expense' : v === '收入' ? 'income' : 'neutral';
}

function base(source: BillSource): Pick<BillRow, 'source' | 'refundedFen' | 'txType' | 'billCategory'> {
  return { source, refundedFen: 0, txType: '', billCategory: '' };
}

/** 合法的单号：去掉「/」等占位 */
const orderOrEmpty = (s: string) => (/^[\w-]+$/.test(s) ? s : '');

// ---------- 支付宝 ----------

function parseAlipay({ header, rows }: Table): BillRow[] {
  const get = columns(
    header,
    { time: '交易时间', dir: '收/支', amount: '金额', status: '交易状态', order: '交易订单号' },
    { category: '交易分类', party: '交易对方', goods: '商品说明', method: '收/付款方式', merchant: '商家订单号' },
  );
  return rows.map((r) => {
    const amountFen = parseAmountFen(get(r, 'amount'));
    const status = get(r, 'status');
    const row: BillRow = {
      ...base('alipay'),
      orderNo: get(r, 'order'),
      time: parseTime(get(r, 'time')),
      direction: direction(get(r, 'dir')),
      amountFen,
      netFen: amountFen,
      counterparty: get(r, 'party'),
      goods: get(r, 'goods'),
      billCategory: get(r, 'category'),
      status,
      method: get(r, 'method'),
      merchantOrderNo: orderOrEmpty(get(r, 'merchant')),
    };
    if (status.includes('退款') && row.direction === 'income') row.refund = 'unmatched';
    row.skip = commonSkip(row) ?? (status === '交易关闭' ? '交易关闭' : undefined);
    return row;
  });
}

// ---------- 微信 ----------

const FULL_REFUND = '已全额退款';

function refundedOf(status: string): number {
  const m = /已退款\(?[¥￥]([\d.,]+)\)?/.exec(status);
  return m ? parseAmountFen(m[1]) : 0;
}

function parseWechat({ header, rows }: Table): BillRow[] {
  const get = columns(
    header,
    { time: '交易时间', dir: '收/支', amount: '金额(元)', status: '当前状态', order: '交易单号' },
    { type: '交易类型', party: '交易对方', goods: '商品', method: '支付方式', merchant: '商户单号' },
  );
  const parsed = rows.map((r) => {
    const amountFen = parseAmountFen(get(r, 'amount'));
    const status = get(r, 'status');
    const txType = get(r, 'type');
    const row: BillRow = {
      ...base('wechat'),
      orderNo: get(r, 'order'),
      time: parseTime(get(r, 'time')),
      direction: direction(get(r, 'dir')),
      amountFen,
      netFen: amountFen,
      counterparty: get(r, 'party'),
      goods: get(r, 'goods'),
      txType,
      status,
      method: get(r, 'method'),
      merchantOrderNo: orderOrEmpty(get(r, 'merchant')),
    };
    if (txType.endsWith('-退款')) {
      row.refund = 'unmatched';
    } else if (row.direction === 'expense') {
      // 原交易：按扣除退款后的实际花费记账
      row.refundedFen = status === FULL_REFUND ? amountFen : refundedOf(status);
      row.netFen = Math.max(0, amountFen - row.refundedFen);
    }
    return row;
  });

  // 退款行与原交易配对（两者单号不同，只能按金额与时间匹配）
  const originals = parsed.filter((r) => r.refundedFen > 0).sort((a, b) => a.time - b.time);
  const used = new Set<BillRow>();
  for (const refund of parsed.filter((r) => r.refund).sort((a, b) => a.time - b.time)) {
    const match = originals.find(
      (o) => !used.has(o) && o.time <= refund.time && o.refundedFen === refund.amountFen,
    );
    if (match) {
      used.add(match);
      refund.refund = 'matched';
    }
  }

  for (const row of parsed) {
    row.skip =
      row.refund === 'matched'
        ? '退款已从原交易中扣除'
        : row.refundedFen > 0 && row.netFen === 0
          ? '已全额退款'
          : commonSkip(row);
  }
  return parsed;
}

function commonSkip(row: BillRow): string | undefined {
  if (!row.orderNo) return '缺少交易单号';
  if (!Number.isFinite(row.time)) return '交易时间无效';
  if (row.direction === 'neutral') return row.source === 'alipay' ? '不计收支' : '中性交易';
  if (!Number.isFinite(row.amountFen)) return '金额无效';
  if (row.amountFen === 0) return '金额为 0';
  return undefined;
}

export function parseBill(table: string[][]): ParsedBill {
  const located = locate(table);
  const source = detectSource(located.header);
  const rows = source === 'alipay' ? parseAlipay(located) : parseWechat(located);
  if (!rows.length) throw new ImportError('账单中没有交易记录');
  const times = rows.map((r) => r.time).filter(Number.isFinite);
  return { source, rows, start: Math.min(...times), end: Math.max(...times) };
}
