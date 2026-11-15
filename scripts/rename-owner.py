#!/usr/bin/env python3
"""
改 GitHub 账号名后，同步仓库内所有引用。

用法：
    python scripts/rename-owner.py 新账号名 [--dry-run]

改完 GitHub 账号名（Settings -> Change username）后立刻跑这个，
否则 package.json 的安装地址、面板的检查更新、CI 的仓库判断会全部 404。

GitHub 对旧用户名有临时重定向，但那只是兜底，不能依赖。
"""
import io
import os
import re
import subprocess
import sys

OLD = 'Mysterylhw'
REPO = 'dsh-purge-plus'

# 按重要程度排序：前四个坏了等于功能失效，后面的只是死链
FILES = [
    'package.json',                 # 安装地址 / repository / homepage / bugs
    'lib/update.js',                # 面板「检查更新」的 REPO 常量
    'lib/redteam/ui.js',            # 红队面板的回退仓库名
    '.github/workflows/release.yml',  # CI 的仓库判断 + Release 链接
    'README.md',
    'README.zh-CN.md',
    'NOTICE.md',
    'DISCLAIMER.md',
    'CHANGELOG.md',
    'client.js',                    # welcome.repo（改了要重新构建才生效）
]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)

    new = sys.argv[1].strip()
    dry = '--dry-run' in sys.argv

    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?', new):
        print('非法 GitHub 用户名: %r' % new)
        print('规则：字母数字和 - ，不能以下划线/连字符开头或结尾，最长 39 字符')
        sys.exit(2)

    if new == OLD:
        print('新名字与旧名字相同，无需改动。')
        sys.exit(0)

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    total = 0
    changed_files = []

    for rel in FILES:
        p = os.path.join(root, rel)
        if not os.path.exists(p):
            print('  skip  %-32s (不存在)' % rel)
            continue
        s = io.open(p, encoding='utf-8').read()
        n = s.count(OLD)
        if n == 0:
            print('  -     %-32s 无引用' % rel)
            continue
        s2 = s.replace(OLD, new)
        if not dry:
            io.open(p, 'w', encoding='utf-8', newline='\n').write(s2)
        print('  %s %-32s %d 处' % ('改' if not dry else '将改', rel, n))
        total += n
        changed_files.append(rel)

    # client.js 只有在源码 lib/redteam/client.js 里也有 welcome.repo 时才需要重建
    # 这里只改产物；若源码里也有，提示重跑构建
    src_client = os.path.join(root, 'lib', 'redteam', 'client.js')
    if os.path.exists(src_client):
        c = io.open(src_client, encoding='utf-8').read()
        if OLD in c:
            print()
            print('注意：lib/redteam/client.js 里也有 %s，需要重跑构建让产物生效：' % OLD)
            print('      node scripts/build-client.mjs')

    print()
    if dry:
        print('[dry-run] 共 %d 处待改，未写入。' % total)
        return

    print('共改 %d 处，涉及 %d 个文件。' % (total, len(changed_files)))

    # 同步 git remote
    try:
        cur = subprocess.run(['git', 'remote', 'get-url', 'origin'],
                             cwd=root, capture_output=True, text=True).stdout.strip()
        if OLD in cur:
            newurl = cur.replace(OLD, new)
            subprocess.run(['git', 'remote', 'set-url', 'origin', newurl],
                           cwd=root, check=True)
            print('git remote: %s -> %s' % (cur, newurl))
    except Exception as e:
        print('git remote 更新失败（手动执行）: %s' % e)

    print()
    print('下一步：')
    print('  1. node scripts/check-links.mjs      检查本地链接')
    print('  2. node scripts/check-patches.mjs    补丁表完整性')
    print('  3. git add -A && git commit -m "chore: 账号改名 %s -> %s"' % (OLD, new))
    print('  4. git push origin main              （GitHub 旧名有临时重定向，能推上去）')
    print('  5. 确认 package.json 的 tarball 地址能访问：')
    print('     curl -I https://github.com/%s/%s/archive/refs/heads/main.tar.gz' % (new, REPO))


if __name__ == '__main__':
    main()
