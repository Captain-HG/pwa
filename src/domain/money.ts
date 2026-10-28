/** 金额全部以「分」为整数存储，只在输入解析和显示时与「元」互转 */

/** "12.5" -> 1250；格式非法返回 NaN。按字符串拆分计算，避免浮点误差 */
export function yuanToFen(input: string): number {
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(input.trim());
  if (!m || (m[1] === '' && !m[2])) return NaN;
  const intPart = m[1] === '' ? 0 : parseInt(m[1], 10);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return intPart * 100 + parseInt(frac, 10);
}

/** 1234567 -> "12,345.67" */
export function formatFen(fen: number): string {
  const abs = Math.abs(fen);
  const yuan = Math.floor(abs / 100);
  const cents = abs % 100;
  return (fen < 0 ? '-' : '') + yuan.toLocaleString('en-US') + '.' + String(cents).padStart(2, '0');
}

/** 2050 -> "20.5"，用于编辑时回填键盘 */
export function fenToInput(fen: number): string {
  const yuan = Math.floor(fen / 100);
  const cents = fen % 100;
  if (cents === 0) return String(yuan);
  return yuan + '.' + String(cents).padStart(2, '0').replace(/0$/, '');
}

export function hasOperator(expr: string): boolean {
  return /\d[+-]\d/.test(expr);
}

/** 求值只含 + - 的表达式，全程用分计算。末尾多余的运算符忽略；空串为 0 */
export function evalExpression(expr: string): number {
  const e = expr.replace(/[+-]$/, '');
  if (e === '') return 0;
  const tokens = e.split(/([+-])/);
  let total = yuanToFen(tokens[0]);
  for (let i = 1; i < tokens.length; i += 2) {
    const v = yuanToFen(tokens[i + 1]);
    total += tokens[i] === '+' ? v : -v;
  }
  return total;
}
