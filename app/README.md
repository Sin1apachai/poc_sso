# แอป A/B — โค้ดร่วม แต่ข้อมูลและ session แยก

Compose กำหนด environment แยกชื่อระบบ ฐานข้อมูล cookie และ client ของ A/B

- Local Login ตรวจรหัสผ่านของแอปนี้ สร้าง app token/session โดยไม่เรียก Keycloak
- SSO สร้าง state/verifier ตรวจความพร้อม แล้วเปิดคำขอที่ C
- `/sso/callback` รับ JWT ผ่าน browser POST จาก Keycloak ตรวจ RS256/issuer/audience/expiry/state/challenge/read และบัญชี local email ตรงกัน แล้วสร้าง session ของแอป
- callback ตอบหน้าสำเร็จในเฟรมและส่ง `sso-complete` ไปหน้าส่งต่อ C ไม่มี token ในข้อความ จากนั้น browser เปิดหน้าหลัก A/B
- Heartbeat ทุก 1 ชั่วโมงใช้ custom introspection; protected requests ตรวจ JWT expiry ด้วย
- `/logout/control` ตรวจ signed notification จาก C ล้างเฉพาะ SSO sessions และแจ้งแท็บผ่าน SSE
- Logout ปกติออกเฉพาะระบบนี้ Local sessions ไม่ถูกล้างจาก Logout C

Token กลางและ app token เก็บใน server-side session ของแอป Browser มีเพียง session cookie และ cookie ผูกคำขอ SSO ไม่ใช้ localStorage

อ่าน [README หลัก](../README.md), [flow](../docs/flows/LOGIN-AND-SESSION.md) และ [API](../docs/flows/API-CATALOG.md)
