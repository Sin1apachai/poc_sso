# เอกสาร Keycloak ของ SSO PoC

| เอกสาร                                             | อ่านเพื่ออะไร                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [SETUP-GUIDE.md](SETUP-GUIDE.md)                   | ตั้งค่าทีละเมนู พร้อมค่าที่ใส่ เหตุผล ภาพ UI และวิธีตรวจปัญหา                                   |
| [FEATURES.md](FEATURES.md)                         | เข้าใจ Realm, IdP, JWT grant, clients, service account, roles/scopes/mappers, keys และ sessions |
| [API-MODE-SETTINGS.json](API-MODE-SETTINGS.json)   | ดู settings reference แบบไม่มี secrets; ไม่ใช่ไฟล์ import realm                                 |
| [API-MODE-POC.md](API-MODE-POC.md)                 | ภาพรวมการทำงานของ JWT grant และ token POST                                                      |
| [HOURLY-HEARTBEAT-POC.md](HOURLY-HEARTBEAT-POC.md) | เงื่อนไข heartbeat ทุก 1 ชั่วโมง                                                                |
| [AB-PREFLIGHT.md](AB-PREFLIGHT.md)                 | ตรวจ Keycloak ก่อน redirect ออกจาก A/B                                                          |
| [SSO-RETRY.md](SSO-RETRY.md)                       | สถานะและ retry การเชื่อมต่อของ C                                                                |
| [Flow และ API](../flows/README.md)                 | sequence diagram, flowchart และจำนวน endpoint/request                                           |

## ที่มาของภาพและการตรวจสอบ

ภาพ PNG 24 ภาพเป็น Admin Console จริงของ Keycloak 26.8.1 สร้างเมื่อ 10 พฤศจิกายน 2026 จาก container ชั่วคราวที่พอร์ต 18080 แยกจากแล็บจริงพอร์ต 8080 บัญชี guide-admin และ learner@example.test เป็นข้อมูลสมมติ ช่อง client secret ถูกปิดบังในภาพ ไม่มี private key, raw access token หรือ password ของผู้ใช้จริงในเอกสาร

ค่าตามคู่มือผ่านการทดสอบใน instance ชั่วคราว:

- JWT bearer grant ของ app-a, app-b และ app-control สำเร็จ
- audience และ idp ตรง; app_permissions แยกตามแอป
- อายุ access token 300 วินาที ไม่ถูกจำกัดเหลือ 60 วินาทีตาม assertion
- assertion เดิมใช้ซ้ำแล้วได้ HTTP 400
- introspection active ก่อน revoke และ inactive หลัง revoke
- service-account client_credentials สำเร็จ
- Admin API templates ทั้ง 12 ที่ C ใช้ผ่าน: ค้นหา/สร้าง/ปรับผู้ใช้, อ่าน/ผูก/ถอน identity link, อ่าน clients/roles, อ่าน/เพิ่ม/ถอน/effective role mappings

การทดสอบนี้ไม่แก้ realm ของคุณ ไม่อัปเดต .env จริง และไม่แทน end-to-end Login ของแอปหลังคุณตั้งค่าเองครบแล้ว
