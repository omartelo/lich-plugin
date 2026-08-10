#!/bin/sh
# Refreshes the vendored copies of lich's hook-contract fixtures.
#
# The fixtures are canonical in the lich repository (docs/hooks/fixtures/
# there). This repository only vendors them so the test suite never needs the
# network. Run this after a contract change lands in lich; CI diffs the copy
# against upstream and fails on drift.
#
# Never hand-edit a fixture to get a green run — a fixture moves in lich, and
# only because the contract moved.
set -eu

base=https://raw.githubusercontent.com/omartelo/lich/main/docs/hooks/fixtures
dir=$(CDPATH= cd -- "$(dirname -- "$0")/fixtures" && pwd)

for name in session-state session-start session-title session-touched; do
  curl -fsSL "$base/$name.jsonl" -o "$dir/$name.jsonl"
  echo "refreshed $name.jsonl"
done
