#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Установите Docker Engine с Compose: https://docs.docker.com/engine/install/" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker недоступен. Запустите Docker и дайте текущему пользователю доступ к нему." >&2
  exit 1
fi

# Docker предоставляет Node; приватный .env остаётся собственностью оператора.
node_in_container() {
  docker run --rm --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$PWD,target=/work" --workdir /work \
    node:24-bookworm-slim node "$@"
}
if [[ -e .env ]]; then
  if [[ $# -gt 0 ]]; then
    echo ".env уже существует. Повторите без параметров: сохранённый адрес и ключи останутся прежними." >&2
    exit 1
  fi
  echo "Использую существующую конфигурацию .env."
else
  # Персональную ссылку печатаем только после успешной проверки HTTPS.
  node_in_container scripts/configure.mjs "$@" >/dev/null
fi

node_in_container --env-file=.env scripts/check-deployment.mjs --config-only
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
node_in_container --env-file=.env scripts/check-deployment.mjs
