#!/usr/bin/env bash
# Neu bauen und auf GitHub Pages (Branch gh-pages) veröffentlichen.
set -euo pipefail
cd "$(dirname "$0")"
npm test
# bump the deploy number (YEAR.MAJOR.N → N+1), commit and push it to main
v=$(node -e "const f='package.json',p=require('./'+f);const a=p.version.split('.');a[2]=String(+a[2]+1);p.version=a.join('.');require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\\n');console.log(p.version)")
git commit -qm "Release $v" package.json && git push -q origin main || true
echo "Version $v"
PAGES_BASE=/messwerk-3d/ npx vite build
touch dist/.nojekyll
tmp=$(mktemp -d)
cp -r dist/. "$tmp"
cd "$tmp"
git init -q -b gh-pages
git add -A
git -c user.name=deanosaurus89 -c user.email=deanosaurus89@users.noreply.github.com commit -qm "Pages: $(date -Iseconds)"
git push -f https://github.com/deanosaurus89/messwerk-3d.git gh-pages
rm -rf "$tmp"
echo "Veröffentlicht: https://deanosaurus89.github.io/messwerk-3d/"
