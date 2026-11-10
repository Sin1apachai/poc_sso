FROM quay.io/keycloak/keycloak:26.8.1 AS sdk
FROM eclipse-temurin:21-jdk AS build
COPY --from=sdk /opt/keycloak/lib/lib/main /sdk
WORKDIR /build
COPY src ./src
COPY theme /theme
RUN mkdir classes && javac -cp '/sdk/*' -d classes $(find src/main/java -name '*.java') && cp -r src/main/resources/* classes/ && jar --create --file /temporary-sso.jar -C classes .
# Override only the native custom-page list module; preserve the original for other providers.
RUN jar --extract --file /sdk/org.keycloak.keycloak-admin-ui-26.8.1.jar theme/keycloak.v2/admin/resources/assets/PageList-Dem_gQcZ.js \
    && cp theme/keycloak.v2/admin/resources/assets/PageList-Dem_gQcZ.js /theme/sso-admin/admin/resources/assets/PageList-original.js
FROM quay.io/keycloak/keycloak:26.8.1
COPY --from=build /theme /opt/keycloak/themes
COPY --from=build /temporary-sso.jar /opt/keycloak/providers/temporary-sso.jar
