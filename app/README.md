# แอป A/B — โค้ดร่วม แต่ข้อมูลและ session แยก

Compose กำหนด environment แยกชื่อระบบ ฐานข้อมูล cookie และ client ของ A/B

- Login ตรวจรหัสผ่านของแอปนี้ สร้าง app token/session โดยไม่เรียก Keycloak
- SSO สร้าง state/verifier ตรวจความพร้อม แล้วเปิดคำขอที่ C
- `/sso/callback` รับ JWT ผ่าน browser POST จาก Keycloak ตรวจ RS256/issuer/audience/expiry/state/challenge/read และบัญชี email ตรงกัน แล้วสร้าง session ของแอป
- callback ตอบหน้าสำเร็จในเฟรมและส่ง `sso-complete` ไปหน้าส่งต่อ C ไม่มี token ในข้อความ จากนั้น browser เปิดหน้าหลัก A/B
- Heartbeat ของหน้า SSO ทุก 1 ชั่วโมง: ตรวจ expiry ก่อน ถ้ายังไม่หมดอายุจึงใช้ custom introspection; protected requests ตรวจ expiry ทุกคำขอและ introspect เมื่อถึงรอบ
- `/logout/control` ตรวจ signed notification จาก C (`control_logout`) หรือ Keycloak (`idp_logout`) ล้างเฉพาะ SSO sessions ตามขอบเขตของ notification และแจ้งแท็บผ่าน SSE
- Logout ปกติออกเฉพาะระบบนี้ Sessions จาก Login ไม่ถูกล้างจาก Logout C

Token ของระบบจาก Login อายุ 1 ชั่วโมง ส่วน SSO app token ไม่เกินอายุ token กลาง การเรียก `/revoke` ต้องใช้ authority C; A/B ใช้ credentials ของตัวเองได้เฉพาะ introspection ใน flow นี้

Token กลางและ app token เก็บใน server-side session ของแอป Browser มีเพียง session cookie และ cookie ผูกคำขอ SSO ไม่ใช้ localStorage

อ่าน [README หลัก](../README.md), [flow](../docs/flows/LOGIN-AND-SESSION.md) และ [API](../docs/flows/API-CATALOG.md)
