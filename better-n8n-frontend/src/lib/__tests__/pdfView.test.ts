import { describe as group, expect, it } from 'vitest';

import {
  MAX_ZOOM, MIN_ZOOM, canvasOutputScale, fitScale, matchingPages, pageAt, parseViewState, stepZoom,
} from '../pdfView';

/** The PDF reader's arithmetic: fitting, zoom steps, the page in view, and resume. */
group('pdfView', () => {
  it('fits a page to the reader width, less the gutter', () => {
    expect(fitScale(644, 612)).toBe(1);
    expect(fitScale(338, 612)).toBe(0.5);
    expect(fitScale(0, 612)).toBe(1);
    expect(fitScale(100000, 612)).toBe(MAX_ZOOM);
  });

  it('steps zoom to the next preset from any value', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.83, 1)).toBe(1);
    expect(stepZoom(0.83, -1)).toBe(0.75);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('finds the page in view from the page tops', () => {
    const tops = [0, 800, 1600, 2400];
    expect(pageAt(tops, 0)).toBe(1);
    expect(pageAt(tops, 799)).toBe(1);
    expect(pageAt(tops, 800)).toBe(2);
    expect(pageAt(tops, 99999)).toBe(4);
    expect(pageAt([], 10)).toBe(1);
  });

  it('draws at screen density until the canvas would be too large', () => {
    expect(canvasOutputScale(600, 800, 2)).toBe(2);
    const big = canvasOutputScale(3000, 4000, 2);
    expect(3000 * big * 4000 * big).toBeLessThanOrEqual(16_000_000 + 1);
    expect(canvasOutputScale(600, 800, 0)).toBe(1);
  });

  it('resumes a saved position and ignores anything odd', () => {
    expect(parseViewState({ page: 3, zoom: 1.5 }, 10)).toEqual({ page: 3, zoom: 1.5 });
    expect(parseViewState({ page: 30, zoom: 'fit' }, 10)).toEqual({ page: 1, zoom: 'fit' });
    expect(parseViewState({ page: 2.5, zoom: 99 }, 10)).toEqual({ page: 1, zoom: MAX_ZOOM });
    expect(parseViewState({}, 10)).toEqual({ page: 1, zoom: 'fit' });
  });

  it('matches pages case-insensitively', () => {
    expect(matchingPages(['Intro', 'the Revenue table', 'REVENUE'], 'revenue')).toEqual([2, 3]);
    expect(matchingPages(['a'], '  ')).toEqual([]);
  });
});
