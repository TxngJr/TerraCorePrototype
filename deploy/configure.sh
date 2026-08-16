#!/usr/bin/env sh
set -eu

usage() {
  echo "Usage: $0 <git-repository-url> <github-owner>" >&2
  echo "Example: $0 https://github.com/acme/TerraCorePrototype.git acme" >&2
  exit 1
}

[ "$#" -eq 2 ] || usage

repo_url=$1
github_owner=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')

case "$repo_url" in
  *'|'*|*'&'*)
    echo "Repository URL contains an unsupported character (| or &)." >&2
    exit 1
    ;;
esac

case "$github_owner" in
  ''|*[!a-z0-9._-]*)
    echo "Invalid GitHub owner: $github_owner" >&2
    exit 1
    ;;
esac

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

sed -i -E \
  "s|^([[:space:]]*repoURL:).*|\\1 ${repo_url}|" \
  "$script_dir/argocd/application.yaml"

sed -i -E \
  "s|^([[:space:]]*newName: ghcr.io/)[^/]+(/terracore-prototype)$|\\1${github_owner}\\2|" \
  "$script_dir/k8s/kustomization.yaml"

echo "Configured Argo CD repository: $repo_url"
echo "Configured container image: ghcr.io/$github_owner/terracore-prototype"
echo "Next: review 'git diff', commit, and push to the main branch."
