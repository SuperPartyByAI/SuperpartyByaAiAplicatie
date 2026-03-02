#!/usr/bin/env bash
set -euo pipefail

BRANCH="fix/use-conversations-public-$(date +%Y%m%d)"

echo "==> Creating branch $BRANCH"
git checkout -b "$BRANCH" || git checkout "$BRANCH"

echo "==> Finding candidate files under lib/ ..."
FILES_FROM=$(git grep -l -E "from\(['\"]conversations['\"]\)" -- lib || true)
FILES_REST=$(git grep -l "rest/v1/conversations" -- lib || true)
FILES_SELECT_PHONE=$(git grep -l -P "select\([^)]*\bphone\b" -- lib || true)
FILES_NAME_ACCESS=$(git grep -l -E "\['name'\]|\.name\b" -- lib || true)

# 1) Replace .from('conversations') -> .from('conversations_public') in lib/
if [ -n "$FILES_FROM" ]; then
  echo "$FILES_FROM" | xargs -r -n1 -I{} bash -c "sed -i.bak \"s/from\(['\\\"']conversations['\\\"']\)/from('conversations_public')/g\" \"{}\""
fi

# 2) Replace REST URLs in lib/
if [ -n "$FILES_REST" ]; then
  echo "$FILES_REST" | xargs -r -n1 -I{} bash -c "sed -i.bak \"s@/rest/v1/conversations@/rest/v1/conversations_public@g\" \"{}\""
fi

# 3) Remove 'phone' tokens inside .select(...) in lib/
if [ -n "$FILES_SELECT_PHONE" ]; then
  echo "$FILES_SELECT_PHONE" | xargs -r -n1 -I{} bash -c "perl -0777 -i.bak -pe \"s/(\.select\([^)]*?)\bphone\b\s*,\s*/\$1/gs; s/(\.select\([^)]*?),\s*\bphone\b([^)]*\))/\1\2/gs\" \"{}\""
fi

# 4) Replace direct map access data['name'] -> data['client_display_name'] **only** where pattern is safe
git ls-files -- lib | xargs -r -n1 -I{} bash -c "sed -i.bak \"s/\bdata\['name'\]/data['client_display_name']/g; s/\bconv\['name'\]/conv['client_display_name']/g; s/\bconversation\['name'\]/conversation['client_display_name']/g\" \"{}\"" || true

echo "==> Show git diff (review carefully)"
git --no-pager diff
