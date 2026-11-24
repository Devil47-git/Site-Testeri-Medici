import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { resolvedCommitDrafts, verifyGitHubSignature, bugFixEmbed, bugFixDisplayName } = await import('../api/github/bugfix.js');

test('Bug Fixer Discord payload matches the blue embed model', () => {
  const embed = bugFixEmbed({
    title: 'fix(inventory): keep reveal running',
    details: 'Search reveal remains active while filtering.',
    author: 'd22tiny',
    pushedBy: 'd22tiny'
  });
  assert.equal(embed.color, 0x2D89F3);
  assert.equal(embed.title, 'fix(inventory): keep reveal running');
  assert.equal(embed.fields[0].name, 'Author');
  assert.equal(embed.fields[1].name, 'Pushed by');
  assert.equal(embed.fields[0].inline, true);
  assert.equal(embed.fields[1].inline, true);
});

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
test('plain resolved text creates a review draft', () => {
  const drafts = resolvedCommitDrafts({
    commits: [{
      id: 'fedcba987654321',
      message: 'resolved Advent Calendar restriction',
      url: 'https://github.com/Devil47-git/Site-Testeri-Medici/commit/fedcba987654321',
      author: { name: 'd22tiny' }
    }]
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].title, 'Advent Calendar restriction');
});

test('GitHub author aliases map to the requested names', () => {
  assert.equal(bugFixDisplayName('d22tiny'), 'Mihail Parvu - Devil');
  assert.equal(bugFixDisplayName('Devil'), 'Mihail Parvu - Devil');
  assert.equal(bugFixDisplayName('AntonioShade'), 'Antonio Shades - AntonioShade');
});

test('GitHub webhook signatures are verified with HMAC SHA-256', () => {
  const secret = 'test-secret';
  const body = '{"commits":[]}';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyGitHubSignature(body, signature, secret), true);
  assert.equal(verifyGitHubSignature(body, 'sha256=wrong', secret), false);
  assert.equal(verifyGitHubSignature(body, signature, ''), false);
});
