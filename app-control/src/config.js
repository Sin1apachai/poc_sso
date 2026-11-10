module.exports = {
  systemId: "app-control",
  port: 4003,
  publicUrl: process.env.PUBLIC_URL,
  oidcIssuer: process.env.OIDC_ISSUER,
  kcAudience: process.env.KC_AUDIENCE,
  kcAuthorityClient: process.env.KC_AUTHORITY_CLIENT,
  kcIdpAlias: process.env.KC_IDP_ALIAS,
  kcIssuer: process.env.KC_ISSUER,
  kcInternalUrl: process.env.KC_INTERNAL_URL,
};
