# ระบบ C — บัญชีและสิทธิ์กลาง

C ตรวจรหัสผ่าน มี session ของตัวเอง และขอ token กลางจาก Keycloak ทันทีหลัง Login อ่านสิทธิ์จาก PostgreSQL แล้วลงลายเซ็น proof ส่งผ่าน browser ให้ Keycloak ส่วน Keycloak ส่ง token เข้า A/B โดยตรง C, A และ B เก็บ JWT กลางใบเดียวกันฝั่ง server ของตัวเอง

- `src/auth/`: password hash, app token, session และ CSRF ของ C
- `src/db/`: บัญชี สิทธิ์ audit และคำขอ SSO ที่รอ Login เก็บ token กลางใน central_sso_status; A/B รับ JWT ใบเดียวกัน
- `src/sso/api-sso.js`: signed proof, callback allowlist และ signed logout
- `src/sso/signing-keys.js`: private key ของ C และ public JWKS ที่ `/oidc/jwks`
- `src/sso/central-token.js`: ขอ token กลาง aud sso-apps ทันทีหลัง Login และตรวจ JWT
- `src/sso/sso-status.js`: retry การออก token จริงสูงสุด 3 ครั้ง และเก็บ token กลางในสถานะฝั่ง server; สถานะพร้อมใช้งานหมายถึงตรวจ token ผ่านแล้ว
- `src/sso/control-proof.js`: ลงลายเซ็นและสร้างข้อมูลสิทธิ์ร่วมกันสำหรับ bootstrap, A/B และ Logout
- `views/sso-post.ejs`, `public/sso-post.js`: ส่ง proof ในเฟรม รอเฉพาะสัญญาณสำเร็จหรือกลับ Login A/B เมื่อหมดเวลา

`POST /logout/keycloak` รับ signed `idp_logout` จาก Keycloak เพื่อล้างสถานะ token กลางเก่าหลัง C ฟื้นตัว โดยคง Login C ไว้ ส่วนการกด Logout C ตามปกติจะ revoke token ผู้ใช้นั้นและแจ้ง A/B ก่อนล้าง session C ของคำขอนี้

Token จาก Login C อายุ 1 ชั่วโมง การหมดอายุ session จาก Login เพียงอย่างเดียวไม่ได้ส่ง global logout และ heartbeat ของ Keycloak ตรวจความพร้อมบริการ C ไม่ได้ตรวจ session ผู้ใช้รายคน

หน้า `/users` จัดการ read/write/delete แยก A/B ไม่มี sync button หรือ Keycloak Admin API ใน C แก้สิทธิ์แล้ว revoke token เดิมและแจ้ง A/B ให้เริ่ม SSO ใหม่

อ่าน [README หลัก](../README.md), [flow](../docs/flows/LOGIN-AND-SESSION.md) และ [settings](../docs/keycloak/SETUP-GUIDE.md)
