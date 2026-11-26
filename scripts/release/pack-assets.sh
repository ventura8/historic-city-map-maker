#!/usr/bin/env bash
# Preserve the directory layout used by each bundle's lazy-loaded code, fonts, translations and notices.
set -euo pipefail

version=$(node -p "require('./package.json').version")
mkdir -p reports/release
npm pack --workspace create-historic-city --pack-destination reports/release
for package in engine admin; do
	tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
		-czf "reports/release/hcm-$package-$version.tar.gz" -C "packages/$package/dist" .
done
