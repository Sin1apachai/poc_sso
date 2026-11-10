# ระบบ C — บัญชีและสิทธิ์กลาง

C ตรวจรหัสผ่าน มี session ของตัวเอง และขอ token กลางจาก Keycloak ทันทีหลัง Login อ่านสิทธิ์จาก PostgreSQL แล้วลงลายเซ็น proof ส่งผ่าน browser ให้ Keycloak ส่วน Keycloak ส่ง token เข้า A/B โดยตรง C server ไม่เก็บ token กลางของ A/B

- `src/auth/`: password hash, app token, session และ CSRF ของ C
- `src/db/`: บัญชี สิทธิ์ audit และคำขอ SSO ที่รอ Login เก็บ token กลางใน central_sso_status; A/B รับ JWT ใบเดียวกัน
- `src/sso/api-sso.js`: signed proof, callback allowlist และ signed logout
- `src/sso/signing-keys.js`: private key ของ C และ public JWKS ที่ `/oidc/jwks`
- `src/sso/central-token.js`: ขอ token กลาง aud sso-apps ทันทีหลัง Login และตรวจ JWT
- `src/sso/sso-status.js`: retry การออก token จริงสูงสุด 3 ครั้ง และเก็บ C token ในสถานะฝั่ง server; success หมายถึงตรวจ JWT ผ่านแล้ว
- `src/sso/control-proof.js`: ลงลายเซ็นและสร้างข้อมูลสิทธิ์ร่วมกันสำหรับ bootstrap, A/B และ Logout
- `views/sso-post.ejs`, `public/sso-post.js`: ส่ง proof ในเฟรม รอเฉพาะสัญญาณสำเร็จหรือกลับ Login A/B เมื่อหมดเวลา

หน้า `/users` จัดการ read/write/delete แยก A/B ไม่มี sync button หรือ Keycloak Admin API ใน C แก้สิทธิ์แล้ว revoke token เดิมและแจ้ง A/B ให้เริ่ม SSO ใหม่

อ่าน [README หลัก](../README.md), [flow](../docs/flows/LOGIN-AND-SESSION.md) และ [settings](../docs/keycloak/SETUP-GUIDE.md)
