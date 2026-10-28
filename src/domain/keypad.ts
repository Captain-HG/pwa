/** 金额键盘的输入规则（详细设计 §6.2），纯函数便于测试 */

export type KeypadKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '00' | '.' | '+' | '-' | 'del';

const MAX_INT_DIGITS = 8;

export function applyKey(expr: string, key: KeypadKey): string {
  if (key === 'del') return expr.slice(0, -1);

  const lastOp = Math.max(expr.lastIndexOf('+'), expr.lastIndexOf('-'));
  const head = expr.slice(0, lastOp + 1);
  const seg = expr.slice(lastOp + 1);

  if (key === '+' || key === '-') {
    if (expr === '') return expr;
    if (seg === '') return head.slice(0, -1) + key;
    return expr + key;
  }

  if (key === '.') {
    if (seg.includes('.')) return expr;
    return head + (seg === '' ? '0.' : seg + '.');
  }

  const dot = seg.indexOf('.');
  if (dot >= 0) {
    const room = 2 - (seg.length - dot - 1);
    return room <= 0 ? expr : expr + key.slice(0, room);
  }
  if (seg === '' && key === '00') return expr;
  if (seg === '0') return key === '0' || key === '00' ? expr : head + key;
  const room = MAX_INT_DIGITS - seg.length;
  return room <= 0 ? expr : expr + key.slice(0, room);
}
