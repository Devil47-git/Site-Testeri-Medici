import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTION_OVERRIDES_KEY, functionOverridesConfigured, functionsForDepartmentRow, readFunctionOverrides, removeFunctionOverride, saveFunctionOverride } from '../lib/access/function-overrides.js';

test('function overrides take precedence over Docs, including explicit empty assignments', () => {
  const overrides = new Map([
    ['member-id', ['Moderator']],
    ['empty-id', []]
  ]);
  assert.equal(functionsForDepartmentRow(['', '', '105', 'Member', '', '', '', '', '', '', 'HR', '', '', '', '', '', '', '', '', 'member-id'], overrides), 'Moderator');
  assert.equal(functionsForDepartmentRow(['', '', '106', 'Member', '', '', '', '', '', '', 'HR', '', '', '', '', '', '', '', '', 'empty-id'], overrides), '');
  assert.equal(functionsForDepartmentRow(['', '', '107', 'Member', '', '', '', '', '', '', 'HR', '', '', '', '', '', '', '', '', 'other-id'], overrides), 'HR');
});

test('function overrides use atomic Redis hash operations and validate stored entries', async () => {
  const commands = [];
  const redis = {
    isConfigured: true,
    async command(...command) {
      commands.push(command);
      if (command[0] === 'HGETALL') return ['member-id', '["Administrator"]'];
      return 1;
    }
  };
  const overrides = await readFunctionOverrides(redis);
  assert.deepEqual([...overrides], [['member-id', ['Administrator']]]);
  await saveFunctionOverride('member-id', [], redis);
  await removeFunctionOverride('member-id', redis);
  assert.deepEqual(commands, [
    ['HGETALL', FUNCTION_OVERRIDES_KEY],
    ['HSET', FUNCTION_OVERRIDES_KEY, 'member-id', '[]'],
    ['HDEL', FUNCTION_OVERRIDES_KEY, 'member-id']
  ]);
  assert.equal(functionOverridesConfigured(redis), true);
});

test('unconfigured override storage is explicit for writes but safely leaves Docs as the default', async () => {
  const redis = { isConfigured: false };
  assert.deepEqual(await readFunctionOverrides(redis), new Map());
  assert.equal(functionOverridesConfigured(redis), false);
  await assert.rejects(() => saveFunctionOverride('member-id', [], redis), /not configured/);
});
