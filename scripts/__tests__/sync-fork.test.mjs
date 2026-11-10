import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../sync-fork.mjs', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'inkos-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, 'gitconfig');
  writeFileSync(config, '[user]\n\tname = kang\n\temail = kang@example.test\n');
  // 所有 Git 身份和配置只属于临时仓库，不读取或修改开发者的全局配置。
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_MERGE_AUTOEDIT: 'no',
  };
  const upstream = join(root, 'upstream.git');
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const work = join(root, 'work');

  function git(cwd, ...args) {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }

  function commit(cwd, file, content, message) {
    writeFileSync(join(cwd, file), content);
    git(cwd, 'add', file);
    git(cwd, 'commit', '-m', message);
    return git(cwd, 'rev-parse', 'HEAD');
  }

  git(root, 'init', '--bare', '--initial-branch=master', upstream);
  git(root, 'init', '--bare', '--initial-branch=master', origin);
  git(root, 'clone', upstream, seed);
  const base = commit(seed, 'shared.txt', '初始内容\n', '初始提交');
  git(seed, 'push', 'origin', 'master');
  git(seed, 'remote', 'add', 'fork', origin);
  git(seed, 'push', 'fork', 'master', 'master:develop');
  git(root, 'clone', origin, work);
  git(work, 'checkout', 'develop');
  git(work, 'remote', 'add', 'upstream', upstream);

  return {
    root, upstream, origin, seed, work, base, git, commit,
    run: () => spawnSync(process.execPath, [script], {
      cwd: work, env, encoding: 'utf8', timeout: 30_000,
    }),
    refs: () => [work, origin, upstream].map((repo) => git(repo, 'show-ref')),
    upstreamCommit(file = 'upstream.txt', content = '上游更新\n') {
      const oid = commit(seed, file, content, '更新上游');
      git(seed, 'push', 'origin', 'master');
      return oid;
    },
  };
}

function assertSuccess(result) {
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}

function assertFailure(result) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('上游更新与 develop 独有提交同步后保留历史并推送两个分支', (t) => {
  const f = fixture(t);
  const own = f.commit(f.work, 'feature.txt', '独有功能\n', '开发功能');
  const upstream = f.upstreamCommit();

  assertSuccess(f.run());

  assert.equal(f.git(f.work, 'branch', '--show-current'), 'develop');
  assert.equal(f.git(f.origin, 'rev-parse', 'master'), upstream);
  assert.equal(f.git(f.work, 'rev-parse', 'master'), upstream);
  const develop = f.git(f.work, 'rev-parse', 'develop');
  assert.equal(f.git(f.origin, 'rev-parse', 'develop'), develop);
  f.git(f.work, 'merge-base', '--is-ancestor', own, develop);
  f.git(f.work, 'merge-base', '--is-ancestor', upstream, develop);
  assert.equal(f.git(f.work, 'rev-list', '--parents', '-n', '1', develop).split(' ').length, 3);
  assert.equal(f.git(f.work, 'status', '--porcelain'), '');
  const beforeRepeat = f.refs();
  assertSuccess(f.run());
  assert.deepEqual(f.refs(), beforeRepeat);
});

for (const state of ['工作区有未跟踪文件', '当前分支是 master']) {
  test(`${state}时拒绝同步且不改变任何 refs`, (t) => {
    const f = fixture(t);
    f.upstreamCommit();
    if (state === '工作区有未跟踪文件') {
      writeFileSync(join(f.work, 'unsaved.txt'), '尚未提交\n');
    } else {
      f.git(f.work, 'checkout', 'master');
    }
    const before = f.refs();
    const branch = f.git(f.work, 'branch', '--show-current');

    assertFailure(f.run());

    assert.deepEqual(f.refs(), before);
    assert.equal(f.git(f.work, 'branch', '--show-current'), branch);
  });
}

for (const location of ['本地', '远端']) {
  test(`${location} master 含有 fork 独有提交时拒绝覆盖`, (t) => {
    const f = fixture(t);
    f.git(f.work, 'checkout', 'master');
    const unique = f.commit(f.work, 'fork-only.txt', '需要保留\n', 'fork 独有提交');
    if (location === '远端') {
      f.git(f.work, 'push', 'origin', 'master');
      f.git(f.work, 'reset', '--hard', f.base);
    }
    f.git(f.work, 'checkout', 'develop');
    f.upstreamCommit();
    const originMaster = f.git(f.origin, 'rev-parse', 'master');
    const localMaster = f.git(f.work, 'rev-parse', 'master');

    assertFailure(f.run());

    assert.equal(f.git(f.work, 'branch', '--show-current'), 'develop');
    assert.equal(f.git(f.work, 'rev-parse', 'master'), localMaster);
    assert.equal(f.git(f.origin, 'rev-parse', 'master'), originMaster);
    assert.equal(location === '本地' ? localMaster : originMaster, unique);
    assert.equal(f.git(f.origin, 'rev-parse', 'develop'), f.base);
  });
}

test('develop 本地与远端分叉时拒绝更新并保留双方提交', (t) => {
  const f = fixture(t);
  const own = f.commit(f.work, 'local-feature.txt', '本地功能\n', '本地开发提交');
  f.git(f.seed, 'checkout', '-b', 'develop', f.base);
  const remote = f.commit(f.seed, 'remote-feature.txt', '远端功能\n', '远端开发提交');
  f.git(f.seed, 'push', 'fork', 'develop');
  f.git(f.seed, 'checkout', 'master');
  f.upstreamCommit();

  assertFailure(f.run());

  assert.equal(f.git(f.work, 'branch', '--show-current'), 'develop');
  assert.equal(f.git(f.work, 'rev-parse', 'develop'), own);
  assert.equal(f.git(f.origin, 'rev-parse', 'develop'), remote);
  assert.equal(f.git(f.work, 'rev-parse', 'master'), f.base);
  assert.equal(f.git(f.origin, 'rev-parse', 'master'), f.base);
  assert.equal(f.git(f.work, 'status', '--porcelain'), '');
});

test('真实合并冲突留在 develop 并允许手动解决或中止', (t) => {
  const f = fixture(t);
  const own = f.commit(f.work, 'shared.txt', '开发分支内容\n', '修改开发内容');
  const upstream = f.upstreamCommit('shared.txt', '上游分支内容\n');

  const result = f.run();
  assertFailure(result);

  assert.equal(f.git(f.work, 'branch', '--show-current'), 'develop');
  assert.equal(f.git(f.work, 'rev-parse', 'HEAD'), own);
  assert.equal(f.git(f.work, 'rev-parse', 'MERGE_HEAD'), upstream);
  assert.match(f.git(f.work, 'status', '--porcelain'), /UU shared\.txt/);
  assert.match(`${result.stdout}\n${result.stderr}`, /git merge --abort/);
  assert.equal(f.git(f.origin, 'rev-parse', 'master'), upstream);
  assert.equal(f.git(f.origin, 'rev-parse', 'develop'), f.base);
  f.git(f.work, 'merge', '--abort');
  assert.equal(f.git(f.work, 'status', '--porcelain'), '');
});

test('远端拒绝 master 推送后恢复 develop 并停止后续合并和推送', (t) => {
  const f = fixture(t);
  const own = f.commit(f.work, 'feature.txt', '开发功能\n', '开发功能');
  f.upstreamCommit();
  const hooks = join(f.origin, 'hooks');
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, 'update'), '#!/bin/sh\nif [ "$1" = "refs/heads/master" ]; then\n  echo "拒绝 master 推送" >&2\n  exit 1\nfi\n', { mode: 0o755 });

  assertFailure(f.run());

  assert.equal(f.git(f.work, 'branch', '--show-current'), 'develop');
  assert.equal(f.git(f.work, 'rev-parse', 'develop'), own);
  assert.equal(f.git(f.origin, 'rev-parse', 'master'), f.base);
  assert.equal(f.git(f.origin, 'rev-parse', 'develop'), f.base);
  assert.equal(f.git(f.work, 'status', '--porcelain'), '');
});
