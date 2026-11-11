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

Token กลางและ app token เก็บใน PostgreSQL ของแอป: ฐานข้อมูลเริ่มต้น A = `app_a`, B = `app_b`, ตาราง `public.session` คอลัมน์ `sess` เป็น JSON โดย `sso.accessToken` เป็น token กลาง, `sso.appToken` เป็น app token หลัง SSO และ `local.appToken` เป็น app token จาก Login ปกติ Browser มีเพียง session cookie และ cookie ผูกคำขอ SSO ไม่ใช้ localStorage ดู [วิธีเชื่อมและ query token](../docs/keycloak/SETUP-GUIDE.md#เชื่อม-postgresql-และหา-token-ที่-ab-เก็บไว้)

A/B ยังใช้ Client ID/Secret กับ custom introspection และตรวจ handoff ผูกกับ Client ของตัวเอง ส่วนการแจ้ง `idp_logout` จาก Keycloak และ `control_logout` จาก C ตรวจ audience กลุ่ม SSO ตาม KC_AUDIENCE ไม่ใช้ Client scopes ปลายทางแจ้งทั้งสองกรณีใช้รายการ Realm settings → Sessions → Logout การเอา URL ออกหยุด notification แต่ยังตรวจ token ที่ถูก revoke ผ่าน heartbeat ตามเดิม

อ่าน [README หลัก](../README.md), [flow](../docs/flows/LOGIN-AND-SESSION.md) และ [API](../docs/flows/API-CATALOG.md)
