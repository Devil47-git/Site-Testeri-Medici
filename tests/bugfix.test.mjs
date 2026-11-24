import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { resolvedCommitDrafts, verifyGitHubSignature } = await import('../api/github/bugfix.js');

test('resolved commit markers create review drafts without auto-publishing', () => {
  const payload = {
    pusher: { name: 'Pusher' },
    commits: [
      {
        id: '1234567890abcdef',
        message: '[resolved] Fix inventory filter\nKeep reveal and filtering active.',
        url: 'https://github.com/example/repo/commit/1234567890abcdef',
        author: { name: 'd22tiny' }
      },
      {
        id: 'abcdef1234567890',
        message: 'Work in progress: filter remains open',
        url: 'https://github.com/example/repo/commit/abcdef1234567890',
        author: { name: 'd22tiny' }
      }
    ]
  };

  const drafts = resolvedCommitDrafts(payload);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].title, 'Fix inventory filter');
  assert.equal(drafts[0].details, 'Keep reveal and filtering active.');
  assert.equal(drafts[0].author, 'd22tiny');
  assert.equal(drafts[0].sha, '1234567890ab');
  assert.equal(drafts[0].status, 'pending');
});

test('GitHub webhook signatures are verified with HMAC SHA-256', () => {
  const secret = 'test-secret';
  const body = '{"commits":[]}';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyGitHubSignature(body, signature, secret), true);
  assert.equal(verifyGitHubSignature(body, 'sha256=wrong', secret), false);
  assert.equal(verifyGitHubSignature(body, signature, ''), false);
});
