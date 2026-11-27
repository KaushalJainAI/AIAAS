import { describe, expect, it } from 'vitest';
import { isRecord, keepRecords } from '../records';

const m = (id: number, record = false) => ({ id, metadata: record ? { record: true } : {} });

describe('keepRecords', () => {
  it('cuts at the index and keeps records after it, in order', () => {
    const list = [m(1), m(2), m(3, true), m(4), m(5, true)];
    expect(keepRecords(list, 1).map(x => x.id)).toEqual([1, 3, 5]);
  });
  it('keeps everything before the cut, records or not', () => {
    expect(keepRecords([m(1, true), m(2)], 1).map(x => x.id)).toEqual([1]);
  });
  it('a missing index leaves the list alone', () => {
    expect(keepRecords([m(1)], -1).map(x => x.id)).toEqual([1]);
  });
  it('knows a record', () => {
    expect(isRecord(m(1, true))).toBe(true);
    expect(isRecord(m(1))).toBe(false);
  });
});
