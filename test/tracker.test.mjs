// lib/tracker.mjs: the project's issue tracker, from its origin remote.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import {
  forgeOf,
  trackerOf,
  webOfRemote,
} from '../skills/tranchant/scripts/lib/tracker.mjs'
import { run, tempDir } from './helpers.mjs'

test('reads the web page of every remote shape git takes', () => {
  for (const [remote, host, repo] of [
    ['git@github.com:acme/app.git', 'github.com', 'acme/app'],
    ['https://github.com/acme/app', 'github.com', 'acme/app'],
    ['https://user:token@github.com/acme/app.git', 'github.com', 'acme/app'],
    [
      'ssh://git@gitlab.example:2222/group/sub/project.git',
      'gitlab.example',
      'group/sub/project',
    ],
    ['git@gitlab.com:group/project.git/', 'gitlab.com', 'group/project'],
  ]) {
    assert.deepEqual(
      webOfRemote(remote),
      { host, path: repo, web: `https://${host}/${repo}` },
      remote,
    )
  }
})

test('an SSH endpoint or an account alias names the forge itself', () => {
  assert.equal(
    webOfRemote('ssh://git@ssh.github.com:443/acme/app.git')?.host,
    'github.com',
  )
  assert.equal(
    webOfRemote('git@github.com-work:acme/app.git')?.web,
    'https://github.com/acme/app',
  )
  assert.equal(webOfRemote('ssh://git@altssh.gitlab.com:443/g/p.git')?.host, 'gitlab.com')
})

test('GitHub by its hosts, GitLab by its name or the MR, and no other forge', () => {
  for (const host of ['github.com', 'acme.ghe.com', 'github.acme.io'])
    assert.equal(forgeOf(host, false), 'github', host)
  for (const host of ['gitlab.com', 'gitlab.acme.io', 'code-gitlab.acme.io'])
    assert.equal(forgeOf(host, false), 'gitlab', host)
  assert.equal(forgeOf('code.acme.io', true), 'gitlab')
  for (const host of [
    'bitbucket.org',
    'codeberg.org',
    'code.acme.io',
    'mirror.github-pages.io',
  ])
    assert.equal(forgeOf(host, false), undefined, host)
})

test('a remote that is no forge has no web page', () => {
  for (const remote of [
    '/srv/git/app.git',
    'file:///srv/app.git',
    '../app',
    'git@host:../x',
    '',
  ])
    assert.equal(webOfRemote(remote), undefined, remote)
})

test('the tracker is GitHub on a github host, GitLab on a review with an MR, with the project within its repository', async (t) => {
  const root = await tempDir(t)
  await run('git', ['-C', root, 'init', '-q'])
  await run('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:acme/app.git'])
  const web = path.join(root, 'web')
  await mkdir(web)
  assert.deepEqual(await trackerOf(web), {
    kind: 'github',
    host: 'github.com',
    path: 'acme/app',
    web: 'https://github.com/acme/app',
    prefix: 'web/',
  })
  await run('git', [
    '-C',
    root,
    'remote',
    'set-url',
    'origin',
    'https://code.acme.io/g/app.git',
  ])
  await assert.rejects(trackerOf(root), /code\.acme\.io is neither GitHub nor GitLab/)
  assert.equal((await trackerOf(root, { gitlab: true })).kind, 'gitlab')
})

test('no origin, no tracker: the reason says so', async (t) => {
  const root = await tempDir(t)
  await run('git', ['-C', root, 'init', '-q'])
  await assert.rejects(trackerOf(root), /no origin remote/)
  await assert.rejects(trackerOf(path.join(root, 'gone')), /is not there/)
  const plain = await tempDir(t)
  await assert.rejects(
    trackerOf(plain),
    /git cannot read the origin remote: .*not a git repository/,
  )
})
