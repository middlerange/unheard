#!/usr/bin/env python3
"""Export an explicitly allowed public snapshot, without copying Git history."""

import argparse
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    '.env.example', '.gitignore', '.npmrc', '.nvmrc',
    '.github/workflows/ci.yml', '.github/workflows/expect.yml',
    'README.md', 'LICENSE', 'SKILLS.md',
    'package.json', 'package-lock.json', 'components.json',
    'tsconfig.json', 'tsconfig.app.json', 'vite.config.mts', 'vitest.config.mts',
    'wrangler.toml', 'drizzle.config.ts', 'playwright.config.ts',
    'scripts/patch-worker.mjs', 'scripts/prepare-skill.mjs',
    'scripts/prepare-deploy.mjs',
    'scripts/export-release.py',
    'docs/agent-skill.md', 'docs/release.md',
    'e2e/login.spec.ts', 'data/writing-prompts/no-slop.md',
    'public/apple-touch-icon.png', 'public/banner.png',
    'public/favicon-96x96.png', 'public/favicon.ico', 'public/favicon.svg',
    'public/logo-content.png', 'public/site.webmanifest',
    'public/web-app-manifest-192x192.png', 'public/web-app-manifest-512x512.png',
    'public/uploads/.gitkeep',
}
TREES = {
    'app': {'.ts', '.tsx', '.css'},
    'components': {'.ts', '.tsx', '.css'},
    'lib': {'.ts', '.tsx'},
    'shims': {'.ts'},
    'server': {'.ts'},
    'drizzle-d1': {'.sql', '.json'},
    'skills/content-hub': {'.md', '.py'},
    'data/templates': {'.md'},
}
EXCLUDE = {'lib/db/seed.ts'}
REQUIRED = {'README.md', 'LICENSE', 'package.json', 'package-lock.json',
            'wrangler.toml', 'scripts/patch-worker.mjs', 'scripts/prepare-skill.mjs',
            'scripts/prepare-deploy.mjs',
            'skills/content-hub/SKILL.md', 'lib/schema.ts',
            'data/writing-prompts/no-slop.md'}
SECRET_PATTERNS = [
    rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    rb'gh[pousr]_[A-Za-z0-9]{30,}',
    rb'sk-(?:proj-)?[A-Za-z0-9_-]{24,}',
    rb'AIza[A-Za-z0-9_-]{30,}',
    rb'and' + rb'coms', rb'demo@' + rb'testuser\.com',
]


def snapshot():
    names = {name for name in FILES if (ROOT / name).is_file()}
    for directory, extensions in TREES.items():
        names.update(path.relative_to(ROOT).as_posix()
                     for path in (ROOT / directory).rglob('*')
                     if path.is_file() and path.suffix in extensions
                     and not any(part.startswith('.') for part in path.relative_to(ROOT / directory).parts))
    names -= EXCLUDE
    missing = REQUIRED - names
    if missing:
        raise SystemExit('Missing required release files: ' + ', '.join(sorted(missing)))
    result = {}
    for name in sorted(names):
        path = ROOT / name
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise SystemExit('Refusing release symlink or external path: ' + name)
        content = path.read_bytes()
        if path.suffix not in {'.png', '.ico'} and any(re.search(pattern, content) for pattern in SECRET_PATTERNS):
            raise SystemExit('Potential secret or legacy test credential in: ' + name)
        if name == 'package.json':
            package = json.loads(content)
            package.get('scripts', {}).pop('seed:test', None)
            package.get('scripts', {}).pop('ship', None)
            content = (json.dumps(package, indent=2) + '\n').encode()
        result[name] = content
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='New output directory or .zip file (must not exist)')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise SystemExit('Output already exists; choose a new path: ' + str(output))
    if output.is_relative_to(ROOT):
        raise SystemExit('Choose an output path outside the private checkout.')
    files = snapshot()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.suffix == '.zip':
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in files.items():
                archive.writestr(name, content)
    else:
        output.mkdir()
        for name, content in files.items():
            target = output / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    print(f'Exported {len(files)} allowed files to {output}')
    print('No Git history included. Review the snapshot before publishing.')


if __name__ == '__main__':
    main()
