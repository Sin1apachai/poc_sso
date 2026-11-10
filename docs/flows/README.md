# Flow ของ PoC ที่รันจริง

เอกสารชุดนี้อ้างอิง A/B/C ใน Compose และ Java extension ใน `keycloak/` ที่ย้ายมาใช้จริงแล้ว

## ภาพรวม

C เก็บบัญชี/สิทธิ์และ session ของ C ลงลายเซ็นหลักฐาน Keycloak ตรวจหลักฐาน เก็บสถานะชั่วคราวใน cache TTL และส่ง token ผ่าน browser POST ไป A/B โดยตรง A/B ตรวจ token สิทธิ์และ local account ก่อนสร้าง session ของตน ไม่มี sync user/role mappings เข้า Keycloak

| ID  | Flow                                  | สิ่งที่อ่านต่อ                                           |
| --- | ------------------------------------- | -------------------------------------------------------- |
| F01 | Login local A/B                       | ไม่ใช้ token กลางและไม่เข้าอีกแอปอัตโนมัติ               |
| F02 | Login C โดยตรง                        | สร้าง session C และขอ token กลางทันที ก่อนกดลิงก์แอป     |
| F03 | SSO A/B ยังไม่มี session C            | Login C → signed proof → token จาก Keycloak → A/B        |
| F04 | มี session C แล้วเข้าอีกแอป           | ไม่ถามรหัสผ่านซ้ำ ออก token กลางใบเดียวรวมสิทธิ์ทุกแอป   |
| F05 | ไม่มีสิทธิ์/ไม่มีบัญชี/หลักฐานไม่ผ่าน | กลับ Login พร้อม modal หรือ 400 เมื่อข้อมูลปลอม          |
| F06 | Keycloak ติดต่อไม่ได้                 | ตรวจพร้อมสูงสุด 3 ครั้ง และ timeout กรณีล่มระหว่างส่งต่อ |
| F07 | Heartbeat/expiry/revoke               | ล้าง session เมื่อหมดอายุหรือ inactive                   |
| F08 | Logout A/B                            | ล้างเฉพาะ session แอปนั้น                                |
| F09 | Logout C                              | ยกเลิก token กลางและบังคับ SSO sessions A/B ออก          |
| F10 | จัดการ user/permissions ใน C          | ไม่ sync; แก้แล้ว revoke และให้รับ token ใหม่            |

อ่าน [sequence diagram และ flowchart ของแต่ละ flow](LOGIN-AND-SESSION.md) และ [รายการ API/จำนวน request](API-CATALOG.md)

C ยังเก็บ token กลางของตัวเอง (`aud=sso-apps`) ใน `central_sso_status` ฝั่ง server และเริ่มขอทันทีหลัง Login ไม่เก็บ token กลางของ A/B สถานะสำเร็จต้องผ่านการตรวจ JWT แล้ว ไม่ใช่แค่ Keycloak ตอบ healthcheck

## หลักการเก็บข้อมูล

| ข้อมูล                                    | อยู่ที่ใด                                           |
| ----------------------------------------- | --------------------------------------------------- |
| บัญชี รหัสผ่าน hash และ read/write/delete | PostgreSQL ของ C                                    |
| บัญชี local ของ A/B                       | PostgreSQL แยกแต่ละระบบ                             |
| C session และ app token ของ C             | session ฝั่ง C                                      |
| proof ที่ C ลงลายเซ็น                     | ส่งผ่าน browser ใช้ครั้งเดียว อายุไม่เกิน 60 วินาที |
| ตัวตน/สถานะ token กลาง                    | cache TTL ใน Keycloak extension                     |
| token กลางและ app token A/B               | server-side session ของแอปปลายทาง                   |
| browser                                   | session cookies และ cookie ผูกคำขอ แยกแต่ละระบบ     |

Keycloak ยังเก็บ config realm/client/trust C และกุญแจตามปกติ แต่ไม่มี user row หรือ role mapping ของผู้ใช้ การไม่มีรหัสผ่านซ้ำเกิดจาก session C ไม่ใช่ native Keycloak browser session วิธีนี้ยังไม่มี refresh token

## อ่านลูกศร

User / Browser เป็นผู้ส่ง HTTP จริง Redirect คือ server ตอบ URL แล้ว browser ส่งคำขอถัดไป Token กลางของ C เดิน C → Keycloak → C ผ่าน backend bootstrap ส่วน proof ของ A/B เดิน C → browser → Keycloak และ token A/B เดิน Keycloak → browser → A/B โดยตรง

หน้าส่งต่อ C ใช้เฟรมที่ซ่อน และรับเพียงสัญญาณสำเร็จจาก A/B ที่ไม่มี token เพื่อเปิดหน้าแอป ถ้าไม่สำเร็จภายใน 12 วินาทีจะกลับ Login A/B

ผลทดสอบจริง: [TEST-RESULTS.json](TEST-RESULTS.json) รันซ้ำด้วย `npm run test:integration` ตาม [README หลัก](../../README.md)
