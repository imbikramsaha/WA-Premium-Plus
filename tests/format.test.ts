import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRelative } from '../src/renderer/src/format.ts';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

describe('formatRelative', () => {
  const mondayEvening = at(16, 17, 30);
  it('counts calendar days for far-off times', () => {
    assert.equal(formatRelative(at(17, 22), mondayEvening), 'tomorrow');
    assert.equal(formatRelative(at(18, 7), mondayEvening), 'in 2 days');
    assert.equal(formatRelative(at(14, 9), mondayEvening), '2 days ago');
  });
  it('uses hours and minutes for nearby times', () => {
    assert.equal(formatRelative(at(16, 23, 30), mondayEvening), 'in 6 hours');
    assert.equal(formatRelative(at(17, 0, 30), mondayEvening), 'tomorrow'); // past midnight
    assert.equal(formatRelative(at(16, 17, 45), mondayEvening), 'in 15 minutes');
    assert.equal(formatRelative(mondayEvening + 10_000, mondayEvening), 'in less than a minute');
  });
});
