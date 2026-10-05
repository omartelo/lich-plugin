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

for file in session-state.jsonl session-start.jsonl session-title.jsonl \
  session-touched.jsonl mod-usage.jsonl mod-control.jsonl mod-commands.json; do
  curl -fsSL "$base/$file" -o "$here/fixtures/$file"
  echo "refreshed $file at $ref"
done

# The mod-answer contract is in no lich release yet: its fixture is read at the
# commit of lich's feat/worker-auto-answer branch that adds it, and folds into
# the list above once a release ships it.
answer=274b3d514ea18c0fd68c1da578de1c0b65ef8af0
curl -fsSL "https://raw.githubusercontent.com/omartelo/lich/$answer/docs/hooks/fixtures/mod-answer.jsonl" \
  -o "$here/fixtures/mod-answer.jsonl"
echo "refreshed mod-answer.jsonl at $answer (unreleased)"
