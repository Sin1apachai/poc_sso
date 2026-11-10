module.exports = {
  systemId: "app-control",
  port: 4003,
  publicUrl: process.env.PUBLIC_URL,
  oidcIssuer: process.env.OIDC_ISSUER,
  kcIssuer: process.env.KC_ISSUER,
  kcInternalUrl: process.env.KC_INTERNAL_URL,
};
