import { isValidRowId, updateReturningRows } from './raw-query-rows';

describe('updateReturningRows', () => {
  it('unwraps the [rows, rowCount] tuple returned for UPDATE/DELETE', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(updateReturningRows<{ id: string }>([rows, 2])).toEqual(rows);
  });

  it('unwraps an empty UPDATE result tuple to an empty array', () => {
    expect(updateReturningRows([[], 0])).toEqual([]);
  });

  it('passes a plain rows array (SELECT/INSERT shape) through unchanged', () => {
    const rows = [{ id: 'a' }];
    expect(updateReturningRows(rows)).toEqual(rows);
  });

  it('returns [] for non-array results', () => {
    expect(updateReturningRows(undefined)).toEqual([]);
    expect(updateReturningRows(null)).toEqual([]);
    expect(updateReturningRows('rows')).toEqual([]);
  });

  it('does not mistake tuple elements for rows', () => {
    // Regression: iterating the raw UPDATE tuple used to visit the inner
    // array and the count as "rows", producing undefined ids.
    const result = updateReturningRows<{ id: string }>([[{ id: 'x' }], 1]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('x');
  });
});

describe('isValidRowId', () => {
  it('accepts non-empty strings', () => {
    expect(isValidRowId('abc')).toBe(true);
  });

  it('rejects undefined, null, empty string, and non-strings', () => {
    expect(isValidRowId(undefined)).toBe(false);
    expect(isValidRowId(null)).toBe(false);
    expect(isValidRowId('')).toBe(false);
    expect(isValidRowId(0)).toBe(false);
    expect(isValidRowId({})).toBe(false);
  });
});
