import { describe, expect, it } from 'vitest';

import { parseCsv } from '../csv';
import {
  cellRef, chunk, columnName, diffCells, parseTasks, serializeTasks, sizeGrid, toCsv, typedValue,
} from '../sheetGrid';

describe('cell references', () => {
  it('names columns the way a spreadsheet does', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(
      ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'],
    );
    expect(cellRef(0, 0)).toBe('A1');
    expect(cellRef(9, 2)).toBe('C10');
  });
});

describe('typed values', () => {
  it('reads a typed cell as a spreadsheet does', () => {
    expect(typedValue('42')).toBe(42);
    expect(typedValue('-3.5')).toBe(-3.5);
    expect(typedValue('007')).toBe('007');
    expect(typedValue('=SUM(A1:A3)')).toBe('=SUM(A1:A3)');
    expect(typedValue('')).toBeNull();
    expect(typedValue('TRUE')).toBe(true);
    expect(typedValue('hello')).toBe('hello');
  });
});

describe('diffing', () => {
  it('sends only the cells that changed, including new rows', () => {
    const base = [['a', 'b'], ['1', '2']];
    const next = [['a', 'B'], ['1', '2'], ['x', '']];
    expect(diffCells(base, next)).toEqual([
      { cell: 'B1', value: 'B' },
      { cell: 'A3', value: 'x' },
    ]);
  });

  it('a cleared cell is sent as null', () => {
    expect(diffCells([['a']], [['']])).toEqual([{ cell: 'A1', value: null }]);
  });

  it('chunks respect the server cap', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const grid = [['name', 'note'], ['Smith, John', 'said "hi"\nthen left']];
    const table = parseCsv(toCsv(grid), Infinity);
    expect([table.headers, ...table.rows]).toEqual(grid);
  });

  it('drops the padding the editor adds', () => {
    expect(toCsv(sizeGrid([['a', 'b']], 4, 5))).toBe('a,b\n');
  });

  it('keeps the file delimiter', () => {
    expect(toCsv([['a', 'b']], ';')).toBe('a;b\n');
  });
});

describe('task lists', () => {
  it('round-trips the lines it does not understand', () => {
    const text = '# Plan\n\n- [ ] one\n  - [x] two\nplain line\n';
    const lines = parseTasks(text);
    expect(lines.filter((l) => l.kind === 'task')).toHaveLength(2);
    expect(serializeTasks(lines)).toBe(text);
  });

  it('ticking a task changes only its box', () => {
    const lines = parseTasks('- [ ] ship it\n');
    const [first] = lines;
    if (first.kind !== 'task') throw new Error('expected a task');
    expect(serializeTasks([{ ...first, done: true }])).toBe('- [x] ship it\n');
  });
});
