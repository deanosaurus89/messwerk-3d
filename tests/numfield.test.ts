import { describe, expect, it } from 'vitest';
import { parseNum } from '../src/ui/numfield';
describe('parseNum (iPhone / German keyboard)', () => {
  it('accepts , and . and typographic minus', () => {
    expect(parseNum('1,5')).toBe(1.5); expect(parseNum('1.5')).toBe(1.5); expect(parseNum('−0,25')).toBe(-0.25); expect(parseNum('-0.25')).toBe(-0.25);
    expect(parseNum('+0,1')).toBe(0.1); expect(parseNum(' 12 ')).toBe(12); expect(parseNum(',5')).toBe(0.5); expect(parseNum('1e-3')).toBe(0.001);
  });
  it('empty → null, junk → NaN', () => { expect(parseNum('')).toBe(null); expect(parseNum('-')).toBe(null); expect(parseNum('1,2,3')).toBeNaN(); expect(parseNum('abc')).toBeNaN(); });
});
