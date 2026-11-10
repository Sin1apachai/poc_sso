#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres --set=password="$CONTROL_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE app_control_user LOGIN PASSWORD %L', :'password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_control_user')
\gexec
SELECT 'CREATE DATABASE app_control OWNER app_control_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='app_control')
\gexec
SQL
