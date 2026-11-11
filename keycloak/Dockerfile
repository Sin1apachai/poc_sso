FROM quay.io/keycloak/keycloak:26.8.1 AS sdk
FROM eclipse-temurin:21-jdk AS build
COPY --from=sdk /opt/keycloak/lib/lib/main /sdk
WORKDIR /build
COPY src ./src
COPY theme /theme
COPY patch-sessions.sed ./patch-sessions.sed
RUN mkdir classes && javac -cp '/sdk/*' -d classes $(find src/main/java -name '*.java') && cp -r src/main/resources/* classes/ && jar --create --file /temporary-sso.jar -C classes .
# Override only the native custom-page list module; preserve the original for other providers.
RUN jar --extract --file /sdk/org.keycloak.keycloak-admin-ui-26.8.1.jar theme/keycloak.v2/admin/resources/assets/PageList-Dem_gQcZ.js \
    && cp theme/keycloak.v2/admin/resources/assets/PageList-Dem_gQcZ.js /theme/sso-admin/admin/resources/assets/PageList-original.js
# Render the Heartbeat UiTabProvider with native Keycloak controls; retain other extension pages.
RUN jar --extract --file /sdk/org.keycloak.keycloak-admin-ui-26.8.1.jar theme/keycloak.v2/admin/resources/assets/PageHandler-BFE3e141.js \
    && cp theme/keycloak.v2/admin/resources/assets/PageHandler-BFE3e141.js /theme/sso-admin/admin/resources/assets/PageHandler-original.js
# Keep the native JWT IdP form and its Save behavior; extend its fields with Health Check URL.
RUN jar --extract --file /sdk/org.keycloak.keycloak-admin-ui-26.8.1.jar theme/keycloak.v2/admin/resources/assets/JWTAuthorizationGrantSettings-Dxhxd3LQ.js \
    && cp theme/keycloak.v2/admin/resources/assets/JWTAuthorizationGrantSettings-Dxhxd3LQ.js /theme/sso-admin/admin/resources/assets/JWTAuthorizationGrantSettings-original.js
# Extend only the pinned native Sessions form, keeping its existing Save/Revert controls.
RUN jar --extract --file /sdk/org.keycloak.keycloak-admin-ui-26.8.1.jar theme/keycloak.v2/admin/resources/assets/RealmSettingsSection-D2BQeyM3.js \
    && sed -f patch-sessions.sed theme/keycloak.v2/admin/resources/assets/RealmSettingsSection-D2BQeyM3.js > /theme/sso-admin/admin/resources/assets/RealmSettingsSection-D2BQeyM3.js \
    && grep -Fq 'useSessionLogoutSettings(v,w)' /theme/sso-admin/admin/resources/assets/RealmSettingsSection-D2BQeyM3.js \
    && grep -Fq 'onClick:logout.revert' /theme/sso-admin/admin/resources/assets/RealmSettingsSection-D2BQeyM3.js
FROM quay.io/keycloak/keycloak:26.8.1
COPY --from=build /theme /opt/keycloak/themes
COPY --from=build /temporary-sso.jar /opt/keycloak/providers/temporary-sso.jar
