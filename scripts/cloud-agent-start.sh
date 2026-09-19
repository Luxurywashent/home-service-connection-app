#!/usr/bin/env bash
#
# Cloud Agent start script: bring up the local MariaDB daemon each boot.
#
# The install script provisions the data directory and schema; this script only
# (re)starts the daemon. It is idempotent: if MariaDB is already answering it
# exits successfully, and it clears a stale socket before starting.
#
set -euo pipefail

MYSQL_HOME="${HSC_MYSQL_HOME:-$HOME/hsc-mysql}"
DATADIR="$MYSQL_HOME/data"
SOCKET="$MYSQL_HOME/mysql.sock"
DB_PORT=3306

if [ ! -d "$DATADIR/mysql" ]; then
  echo "WARN: MariaDB data directory missing at $DATADIR; skipping DB start." >&2
  exit 0
fi

if mysqladmin --socket="$SOCKET" ping >/dev/null 2>&1; then
  echo "MariaDB already running."
  exit 0
fi

MARIADBD="$(command -v mariadbd || command -v mysqld || true)"
if [ -z "$MARIADBD" ]; then
  echo "WARN: mariadbd not found; skipping DB start." >&2
  exit 0
fi

rm -f "$SOCKET"
nohup "$MARIADBD" --no-defaults --datadir="$DATADIR" --socket="$SOCKET" \
  --pid-file="$MYSQL_HOME/mysqld.pid" --bind-address=127.0.0.1 --port="$DB_PORT" \
  >"$MYSQL_HOME/mariadb.log" 2>&1 &

for _ in $(seq 1 30); do
  if mysqladmin --socket="$SOCKET" ping >/dev/null 2>&1; then
    echo "MariaDB is ready on 127.0.0.1:${DB_PORT}."
    exit 0
  fi
  sleep 1
done

echo "MariaDB failed to become ready; see $MYSQL_HOME/mariadb.log" >&2
exit 1
