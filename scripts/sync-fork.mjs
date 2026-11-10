#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function git(args, capture = false) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} 执行失败：\n${result.stdout}${result.stderr}`);
  }
  if (!capture) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  return result.stdout.trim();
}

function isAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`无法比较 ${ancestor} 与 ${descendant}：${result.stderr}`);
}

try {
  process.chdir(git(["rev-parse", "--show-toplevel"], true));
  if (git(["branch", "--show-current"], true) !== "develop") {
    throw new Error("请先切换到 develop 分支再同步。");
  }
  if (git(["status", "--porcelain"], true)) {
    throw new Error("工作区有未提交改动，请先提交或自行暂存后再同步。");
  }

  git(["fetch", "upstream"]);
  git(["fetch", "origin"]);
  for (const branch of ["master", "origin/master"]) {
    if (!isAncestor(branch, "upstream/master")) {
      throw new Error(`${branch} 含有上游没有的提交，请先人工处理分叉后再同步。`);
    }
  }
  git(["merge", "--ff-only", "origin/develop"]);

  git(["switch", "master"]);
  try {
    git(["merge", "--ff-only", "upstream/master"]);
    git(["push", "origin", "master"]);
  } finally {
    git(["switch", "develop"]);
  }

  // develop 保留自己的提交；合并上游时不改写已发布的历史。
  git(["merge", "--no-edit", "master"]);
  git(["push", "--set-upstream", "origin", "develop"]);
  process.stdout.write("同步完成：master 已对齐上游，develop 已合并并推送到 origin。\n");
} catch (error) {
  process.stderr.write(`同步已停止：${error.message}\n`);
  process.stderr.write("已完成的步骤会保留。若 develop 出现合并冲突，请解决并提交后重跑，或执行 git merge --abort。\n");
  process.exitCode = 1;
}
