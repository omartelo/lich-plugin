#!/bin/sh
# Refreshes the vendored copies of lich's hook-contract fixtures.
#
# The fixtures are canonical in the lich repository (docs/hooks/fixtures/
# there). This repository only vendors them so the test suite never needs the
# network. They are read at the lich release named in tests/lich-ref, never at
# main: a contract lich has merged but not released is one no user's lich
# speaks yet. Move that ref when a lich release changes a contract, run this,
# and make the scripts match; CI diffs the copy against that release and fails
# on drift.
#
# Never hand-edit a fixture to get a green run — a fixture moves in lich, and
# only because the contract moved.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ref=$(tr -d '[:space:]' <"$here/lich-ref")
base=https://raw.githubusercontent.com/omartelo/lich/$ref/docs/hooks/fixtures

for name in session-state session-start session-title session-touched; do
  curl -fsSL "$base/$name.jsonl" -o "$here/fixtures/$name.jsonl"
  echo "refreshed $name.jsonl at $ref"
done

# mod-control is in no lich release yet: it is read at the head of the pull
# request that serves it (omartelo/lich#645), so the module is held to the
# contract that lich is about to ship rather than to none. Once a release
# carries it, move tests/lich-ref there, fold these files into the list above
# and delete this block.
pending=f013e26f98521a2837d4efdd98b54db609fbeb4f
for file in mod-control.jsonl mod-commands.json; do
  curl -fsSL "https://raw.githubusercontent.com/omartelo/lich/$pending/docs/hooks/fixtures/$file" \
    -o "$here/fixtures/$file"
  echo "refreshed $file at $pending (unreleased)"
done
