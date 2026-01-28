#!/bin/bash

# Configuration
OLD_EMAIL_MATCH="zou"
OLD_NAME_MATCH="Borun"
CORRECT_NAME="A2Sumie"
CORRECT_EMAIL="A2Sumie@users.noreply.github.com"
FILES_TO_REMOVE="setup-secrets.sh seed-admins.ts"

echo "Starting git filter-branch rewrite..."

git filter-branch --force --env-filter '
    if [ "$GIT_COMMITTER_EMAIL" = "zou@ZOUdeMacBook-Pro-2.local" ] || [[ "$GIT_COMMITTER_NAME" == *"$OLD_NAME_MATCH"* ]]; then
        export GIT_COMMITTER_NAME="$CORRECT_NAME"
        export GIT_COMMITTER_EMAIL="$CORRECT_EMAIL"
    fi
    if [ "$GIT_AUTHOR_EMAIL" = "zou@ZOUdeMacBook-Pro-2.local" ] || [[ "$GIT_AUTHOR_NAME" == *"$OLD_NAME_MATCH"* ]]; then
        export GIT_AUTHOR_NAME="$CORRECT_NAME"
        export GIT_AUTHOR_EMAIL="$CORRECT_EMAIL"
    fi
' --index-filter "git rm -rf --cached --ignore-unmatch $FILES_TO_REMOVE" --prune-empty --tag-name-filter cat -- --all

echo "Rewrite complete."
