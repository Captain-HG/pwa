import { describe, expect, it } from 'vitest';
import { evalExpression, fenToInput, formatFen, hasOperator, yuanToFen } from '@/domain/money';
import { applyKey, type KeypadKey } from '@/domain/keypad';

describe('money', () => {
  it('yuanToFen', () => {
    expect(yuanToFen('12.5')).toBe(1250);
    expect(yuanToFen('0.01')).toBe(1);
    expect(yuanToFen('5.')).toBe(500);
    expect(yuanToFen('.5')).toBe(50);
    expect(yuanToFen('')).toBeNaN();
    expect(yuanToFen('.')).toBeNaN();
    expect(yuanToFen('1.234')).toBeNaN();
  });

  it('formatFen', () => {
    expect(formatFen(1234567)).toBe('12,345.67');
    expect(formatFen(5)).toBe('0.05');
    expect(formatFen(-2800)).toBe('-28.00');
  });

  it('fenToInput', () => {
    expect(fenToInput(2050)).toBe('20.5');
    expect(fenToInput(2000)).toBe('20');
    expect(fenToInput(2005)).toBe('20.05');
  });

  it('evalExpression（F03 / F04）', () => {
    expect(evalExpression('12.5+8')).toBe(2050);
    expect(evalExpression('0.1+0.2')).toBe(30);
    expect(evalExpression('10-2.5+')).toBe(750);
    expect(evalExpression('')).toBe(0);
    expect(evalExpression('5-10')).toBe(-500);
    expect(hasOperator('12.5+8')).toBe(true);
    expect(hasOperator('12.5+')).toBe(false);
  });
});

describe('keypad', () => {
  const type = (keys: KeypadKey[]) => keys.reduce(applyKey, '');

  it('小数最多两位（F06）', () => {
    expect(type(['1', '.', '2', '3', '4'])).toBe('1.23');
    expect(type(['1', '.', '2', '00'])).toBe('1.20');
  });

  it('前导 0 与小数点', () => {
    expect(type(['0', '5'])).toBe('5');
    expect(type(['0', '0'])).toBe('0');
    expect(type(['.'])).toBe('0.');
    expect(type(['00'])).toBe('');
    expect(type(['1', '.', '.'])).toBe('1.');
  });

  it('运算符', () => {
    expect(type(['+'])).toBe('');
    expect(type(['1', '+', '-'])).toBe('1-');
    expect(type(['1', '2', '.', '5', '+', '8'])).toBe('12.5+8');
    expect(type(['1', '+', '.', '5'])).toBe('1+0.5');
  });

  it('整数最多 8 位、退格', () => {
    expect(type(['9', '9', '9', '9', '9', '9', '9', '9', '9'])).toBe('99999999');
    expect(type(['1', '2', 'del'])).toBe('1');
  });
});
