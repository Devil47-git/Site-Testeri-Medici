import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseKV } from '../lib/storage/supabase-kv.js';

test('Supabase storage sends service credentials and Redis-compatible RPC commands', async () => {
  let request;
  const storage = new SupabaseKV({
    url: 'https://project.supabase.co/',
    key: 'server-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify('OK'), { status: 200 });
    }
  });

  assert.equal(await storage.command('SET', 'key', 'value', 'NX', 'EX', '60'), 'OK');
  assert.equal(request.url, 'https://project.supabase.co/rest/v1/rpc/app_kv_execute');
  assert.equal(request.options.headers.apikey, 'server-secret');
  assert.equal(request.options.headers.Authorization, 'Bearer server-secret');
  assert.deepEqual(JSON.parse(request.options.body), {
    p_command: 'SET',
    p_args: ['key', 'value', 'NX', 'EX', '60']
  });
});

test('Supabase storage parses pipeline and JSON helper responses', async () => {
  const requests = [];
  const storage = new SupabaseKV({
    url: 'https://project.supabase.co',
    key: 'server-secret',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('app_kv_pipeline')) return new Response(JSON.stringify([1, ['member']]), { status: 200 });
      return new Response(JSON.stringify('{"ready":true}'), { status: 200 });
    }
  });

  assert.deepEqual(await storage.pipeline([['EXISTS', 'key'], ['SMEMBERS', 'set']]), [1, ['member']]);
  assert.deepEqual(await storage.getJson('json:key'), { ready: true });
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    p_commands: [['EXISTS', 'key'], ['SMEMBERS', 'set']]
  });
  assert.equal(requests[1].url, 'https://project.supabase.co/rest/v1/rpc/app_kv_execute');
});

test('Supabase storage surfaces server errors and missing configuration', async () => {
  const unconfigured = new SupabaseKV({ url: '', key: '' });
  assert.equal(unconfigured.isConfigured, false);
  await assert.rejects(unconfigured.command('GET', 'key'), /Supabase storage is not configured/);

  const failed = new SupabaseKV({
    url: 'https://project.supabase.co',
    key: 'server-secret',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'permission denied' }), { status: 403 })
  });
  await assert.rejects(failed.command('GET', 'key'), /permission denied/);
});
