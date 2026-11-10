# App Control (C)

IdP ตัวเดียวและแหล่งจัดการผู้ใช้/สิทธิ์ของ PoC ดู [README หลัก](../README.md)

- `src/auth`: ตรวจรหัสผ่านและ session ของ C
- `src/db`: schema, ผู้ใช้, สถานะ SSO และ token registry
- `src/services/keycloak-sync.js`: sync บัญชี, identity link และ client roles
- `src/sso/api-sso.js`: ขอ central token, ส่ง POST ไป A/B และ revoke/logout
- `src/sso/signing-keys.js`: โหลด private key สำหรับลงลายเซ็น และส่งเฉพาะ public key ที่ /oidc/jwks

C เก็บ private key ฝั่ง server; Keycloak ตรวจ assertion แล้วออก token กลางให้ client เป้าหมาย C ไม่ส่งรหัสผ่านผู้ใช้ให้ Keycloak
