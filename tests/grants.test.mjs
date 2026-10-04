import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readValues } from '../api/access/grants.js';

test('member rows are cached without mutating a frozen Google Sheets client', async () => {
  let reads = 0;
  const values = [['header'], ['member']];
  const sheets = Object.freeze({
    spreadsheets: Object.freeze({
      values: Object.freeze({
        get: async () => {
          reads += 1;
          return { data: { values } };
        }
      })
    })
  });

  const first = await readValues(sheets, 'LISTA DEPARTAMENT!A1:T400');
  const second = await readValues(sheets, 'LISTA DEPARTAMENT!A1:T400');

  assert.strictEqual(first, values);
  assert.strictEqual(second, values);
  assert.equal(reads, 1);
  assert.equal(Object.hasOwn(sheets, '__memberRows'), false);
});
