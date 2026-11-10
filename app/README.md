# Shared A/B application

โค้ดเดียวแยกการทำงานผ่าน environment ของ Compose ดูการเริ่มใช้งานที่ [README หลัก](../README.md)

- `src/auth`: local Login, session, CSRF และ app token
- `src/db`: schema และฐานข้อมูลของแอป
- `src/sso`: preflight, token POST callback, heartbeat และ logout notifications
- `src/routes.js`: เส้นทางของแอป

Local Login ไม่ใช้ Keycloak ส่วน SSO ต้องมี `read` และมี local account ที่ email ตรงกัน Session ของ A/B แยกจากกัน
