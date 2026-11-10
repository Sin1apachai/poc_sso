FROM postgres:17
COPY init/ /docker-entrypoint-initdb.d/
RUN chmod 0644 /docker-entrypoint-initdb.d/*.sh
