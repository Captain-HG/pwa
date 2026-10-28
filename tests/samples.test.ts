/**
 * 用 samples/ 中的真实账单核对解析结果（只输出汇总，不打印明细）。
 * samples/ 不提交到代码库，没有样本时自动跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeText, readTable } from '@/import/read';
import { parseBill } from '@/import/parse';
import { planImport, summarize } from '@/import/plan';
import { presetCategories } from '@/db/seed';

const dir = path.resolve(__dirname, '../samples');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(csv|xlsx)$/i.test(f)) : [];

/** 账单开头的汇总，例如「支出：25笔 723.16元」 */
function headerSummary(bytes: Uint8Array): Record<string, { count: number; fen: number }> {
  const text = bytes[0] === 0x50 ? readTable(bytes).slice(0, 20).map((r) => r.join('')).join('\n') : decodeText(bytes);
  const out: Record<string, { count: number; fen: number }> = {};
  for (const m of text.matchAll(/(收入|支出|不计收支|中性交易)：(\d+)笔\s*([\d.]+)元/g)) {
    out[m[1]] = { count: Number(m[2]), fen: Math.round(Number(m[3]) * 100) };
  }
  return out;
}

describe.skipIf(!files.length)('真实样本核对', () => {
  for (const file of files) {
    it(file.replace(/\(.*$/, ''), () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
      const bill = parseBill(readTable(bytes));
      const expected = headerSummary(bytes);

      // 解析出的原始笔数、金额与账单汇总一致
      for (const [label, dir] of [['支出', 'expense'], ['收入', 'income']] as const) {
        const rows = bill.rows.filter((r) => r.direction === dir);
        const fen = rows.reduce((s, r) => s + r.amountFen, 0);
        if (expected[label]) expect({ label, count: rows.length, fen }).toEqual({ label, ...expected[label] });
      }

      const plan = planImport(bill.rows, {
        existing: new Map(),
        manual: [],
        rules: [],
        categories: new Map(presetCategories().map((c) => [c.id, c])),
        now: Date.now(),
      });
      const s = summarize(plan);
      const reasons: Record<string, number> = {};
      for (const p of plan) if (p.kind === 'skip') reasons[p.reason!] = (reasons[p.reason!] ?? 0) + 1;
      const byCategory: Record<string, number> = {};
      for (const p of plan) if (p.kind === 'new') byCategory[p.tx.categoryId!] = (byCategory[p.tx.categoryId!] ?? 0) + 1;
      console.log(
        `\n[${bill.source}] 共 ${bill.rows.length} 条；新增 ${s.counts.new}（支出 ${s.newTotal.expense / 100}，收入 ${s.newTotal.income / 100}）；跳过 ${s.counts.skip}`,
        '\n  跳过原因：', reasons,
        '\n  分类分布：', byCategory,
      );
      expect(plan.every((p) => p.id.length <= 64)).toBe(true);
      expect(new Set(plan.map((p) => p.id)).size).toBe(plan.length);
    });
  }
});
