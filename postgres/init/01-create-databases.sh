#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_a_password="$APP_A_DB_PASSWORD" \
  --set=app_b_password="$APP_B_DB_PASSWORD" <<'SQL'
CREATE USER app_a_user WITH PASSWORD :'app_a_password';
CREATE DATABASE app_a OWNER app_a_user;

CREATE USER app_b_user WITH PASSWORD :'app_b_password';
CREATE DATABASE app_b OWNER app_b_user;
SQL