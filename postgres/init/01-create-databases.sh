#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_a_password="$APP_A_DB_PASSWORD" \
  --set=app_b_password="$APP_B_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE app_a_user LOGIN PASSWORD %L', :'app_a_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_a_user')
\gexec
SELECT 'CREATE DATABASE app_a OWNER app_a_user' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='app_a')
\gexec

SELECT format('CREATE ROLE app_b_user LOGIN PASSWORD %L', :'app_b_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_b_user')
\gexec
SELECT 'CREATE DATABASE app_b OWNER app_b_user' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='app_b')
\gexec
SQL
