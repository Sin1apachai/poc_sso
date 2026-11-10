# รายการ Flow และ API ของ SSO PoC

เอกสารนี้อ้างอิงโค้ดที่รันจริง ไม่ใช่ flow OIDC broker แบบเก่า C เป็น IdP ตัวเดียวและเป็นแหล่งบัญชี/สิทธิ์ Keycloak ออก token ส่วน A/B สร้าง session ของตัวเอง

สถานะหลังการล้าง Keycloak: realm ต้องตั้งค่าใหม่ก่อนทดสอบ SSO เอกสารอธิบายพฤติกรรมเมื่อค่าครบ ไม่ได้แปลว่าระบบ runtime พร้อมแล้ว

## รายการ flow

ทุก flow มี sequence diagram, flowchart และจำนวน request ใน [รายละเอียดแต่ละ flow](LOGIN-AND-SESSION.md)

| ID  | Flow                                            | Keycloak ที่ใช้หลัก ๆ                      |
| --- | ----------------------------------------------- | ------------------------------------------ |
| F01 | Login local A/B                                 | ไม่ใช้                                     |
| F02 | Login C และขอ token สำหรับ C                    | Discovery, token, certs เมื่อจำเป็น        |
| F03 | กด SSO A/B และยังไม่มี session C                | Discovery, token, certs เมื่อจำเป็น        |
| F04 | SSO A/B เมื่อมี session C แล้ว / เปิดจากลิงก์ C | เช่นเดียวกับ F03 แต่ไม่กรอกรหัสผ่าน C      |
| F05 | ไม่มีสิทธิ์ / ไม่มีบัญชีตรงกัน                  | อาจปฏิเสธก่อนขอ token หรือหลังได้รับ token |
| F06 | Keycloak ติดต่อไม่ได้ / ออก token ไม่ได้        | Discovery หรือ token ล้มเหลว               |
| F07 | Heartbeat / token หมดอายุ / ถูก revoke          | Introspection เฉพาะ token ยังไม่หมดอายุ    |
| F08 | Logout A/B                                      | ไม่ใช้                                     |
| F09 | Logout C และบังคับ A/B ออก                      | Revoke และ signed notification ไป A/B      |
| F10 | สร้าง/แก้ไข/Sync/ปิด/ลบผู้ใช้ C                 | Admin API; ปิด/ลบมี revoke ด้วย            |

## นับ API อย่างไร

- **1 endpoint = HTTP method + path template** เช่น GET /login กับ POST /login นับคนละเส้น
- เปลี่ยน user ID หรือ client ID ไม่เพิ่มจำนวน endpoint; query string ไม่เพิ่มจำนวน endpoint
- จำนวน endpoint ไม่เท่ากับจำนวน request: retry, loop, polling และ cache ทำให้จำนวนครั้งเปลี่ยนได้
- รวมหน้า HTML, callback, JSON และ SSE ในตาราง HTTP routes แล้วระบุชนิดไว้ ไม่เรียกทุกเส้นว่า JSON API
- ไม่รวมไฟล์ static เช่น CSS/JS, favicon และ healthcheck ที่ Docker เรียกซ้ำในจำนวน request ของ Login

| หมวด                                 |      จำนวน | ขอบเขต                                           |
| ------------------------------------ | ---------: | ------------------------------------------------ |
| A/B                                  | 14 ต่อระบบ | โค้ดเดียว คนละ host/port รวม 28 routes           |
| C                                    |         18 | รวม JWKS, Login, user management, SSO และ Logout |
| รวม routes ของแอป                    |         46 | A 14 + B 14 + C 18                               |
| Keycloak protocol/support            |          5 | Discovery, certs, token, introspect, revoke      |
| Keycloak Admin API                   |         12 | ใช้ sync บัญชี identity link และ roles           |
| **Keycloak API ที่ backend อ้างอิง** |     **17** | 5 + 12 ไม่ใช่ 17 requests ทุก Login              |

C เปิดเฉพาะ GET /oidc/jwks เพื่อเผยแพร่ public keys ไม่มี OIDC provider library หรือ interaction/consent routes อีกแล้ว JWT issuer ยังใช้ http://localhost:4003/oidc เหมือนเดิมเพื่อคงการตรวจลายเซ็นปัจจุบัน

ดู [รายการ API ครบพร้อมหน้าที่และผู้เรียก](API-CATALOG.md)

## โค้ดที่อ่านประกอบ

| จุด                                       | ไฟล์                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A/B: HTTP routes และ local Login          | [routes.js](../../app/src/routes.js)                                                                                     |
| A/B: ตรวจ response/token และสร้าง session | [sso/keycloak.js](../../app/src/sso/keycloak.js)                                                                         |
| A/B: ตรวจความพร้อมก่อน redirect           | [sso-connectivity.js](../../app/src/sso/sso-connectivity.js)                                                             |
| A/B: heartbeat ฝั่ง browser               | [heartbeat.js](../../app/public/heartbeat.js)                                                                            |
| C: Login, Logout, user management         | [routes.js](../../app-control/src/routes.js)                                                                             |
| C: ขอ token, ส่ง form POST, revoke        | [api-sso.js](../../app-control/src/sso/api-sso.js)                                                                       |
| C: ตรวจความพร้อมและ bootstrap             | [sso-status.js](../../app-control/src/sso/sso-status.js), [central-login.js](../../app-control/src/sso/central-login.js) |
| C: sync บัญชีและสิทธิ์                    | [keycloak-sync.js](../../app-control/src/services/keycloak-sync.js)                                                      |

## อ่านภาพ

User / Browser คือ browser ที่ส่ง request จริง ลูกศร backend → backend หมายถึงเรียกจาก server โดยตรง `Redirect` เป็นคำตอบกลับ browser แล้ว browser จึงเปิด URL ใหม่ การตรวจ JWT ภายในแอปไม่ใช่ request ไป Keycloak ทุกครั้ง

Diagram ใช้ Mermaid บน GitHub เปิดแสดงเป็นภาพได้ ส่วน VS Code ต้องใช้ Markdown preview ที่รองรับ Mermaid
