# HTTP routes และ Keycloak API

[กลับรายการ flow](README.md) · [Diagram แต่ละ flow](LOGIN-AND-SESSION.md)

จำนวนด้านล่างเป็น **method + path template** ไม่ใช่จำนวน HTTP requests ต่อการใช้งาน

## A/B: 14 routes ต่อระบบ

Base URL A = `http://localhost:4001`; B = `http://localhost:4002`

| #   | Method | Path                   | ผู้เรียก / ชนิด              | ทำอะไร                                                            |
| --- | ------ | ---------------------- | ---------------------------- | ----------------------------------------------------------------- |
| A01 | GET    | /health                | Docker / JSON                | ตรวจ DB และสถานะแอป                                               |
| A02 | GET    | /login/local           | Browser / redirect           | ข้าม silent SSO แล้วไปหน้า Login                                  |
| A03 | GET    | /login                 | Browser / HTML หรือ redirect | แสดง Login หรือเริ่ม silent SSO ครั้งแรกของ anonymous session     |
| A04 | POST   | /login                 | Browser / form               | ตรวจรหัสผ่าน local สร้าง app token/session; ต้องมี CSRF           |
| A05 | GET    | /sso                   | Browser / redirect           | เริ่ม explicit SSO พร้อม preflight ใช้ได้จากลิงก์ C หรือ fallback |
| A06 | POST   | /sso/preflight         | Browser JS / JSON            | ตรวจ Keycloak ก่อนเดินทางไป C; ต้องมี CSRF                        |
| A07 | GET    | /sso/connectivity      | Browser JS / JSON            | อ่านความคืบหน้าของ preflight ไม่ได้ยิง Keycloak เพิ่มเอง          |
| A08 | GET    | /sso/callback          | Browser / error redirect     | รับ error จาก C; ไม่รับ token สำเร็จผ่าน GET                      |
| A09 | POST   | /sso/callback          | Browser / form               | รับ token + signed response + state; ตรวจแล้วสร้าง session        |
| A10 | GET    | /session/logout-events | Browser / SSE                | เปิด stream รับเหตุการณ์ Logout จาก server                        |
| A11 | GET    | /session/heartbeat     | Browser / JSON               | ตรวจ app session/central token; introspect เมื่อยังไม่หมดอายุ     |
| A12 | POST   | /logout/control        | C backend / acknowledgement  | รับ signed C logout บันทึก cutoff ล้าง SSO sessions แจ้ง SSE      |
| A13 | GET    | /                      | Browser / HTML               | ตรวจ local หรือ SSO session แล้วแสดง dashboard                    |
| A14 | POST   | /logout                | Browser / form               | Logout เฉพาะแอป ล้าง cookie; ต้องมี CSRF                          |

A09 ใช้ browser-bound state และ signed response แทน generic CSRF form token ตรวจ signature, issuer, audience, expiry, challenge, token hash, one-time state และ Logout cutoff สิทธิ์มาจาก central JWT เท่านั้น

## C: 18 routes

Base URL = `http://localhost:4003`

| #   | Method | Path               | ชนิด     | ทำอะไร                                                                |
| --- | ------ | ------------------ | -------- | --------------------------------------------------------------------- |
| C01 | GET    | /health            | JSON     | ตรวจ DB และสถานะแอป                                                   |
| C02 | GET    | /sso/authorize     | Browser  | รับ client_id/state/challenge/mode; ตรวจ session C หรือแสดง Login     |
| C03 | GET    | /sso/resume        | Browser  | รับคำขอเดิมหลัง Login C แล้วออก token ของแอปปลายทาง                   |
| C04 | GET    | /login             | HTML     | แสดง Login หรือใช้ C session ที่มีอยู่                                |
| C05 | POST   | /login             | Form     | ตรวจรหัสผ่าน สร้าง C session; แยก direct Login กับคำขอจาก A/B         |
| C06 | GET    | /oidc/jwks         | JSON     | อ่าน public keys ของ C เพื่อตรวจ assertion/response/logout            |
| C07 | POST   | /logout            | Form     | revoke tokens แจ้ง A/B แล้วล้าง C session                             |
| C08 | POST   | /sso/retry         | Form     | เริ่มตรวจความพร้อม SSO ใหม่                                           |
| C09 | GET    | /sso/status        | JSON     | อ่านสถานะ/CSRF ให้หน้า dashboard ไม่ได้ขอ token ใหม่เอง               |
| C10 | POST   | /sso/continue      | Form     | เมื่อสถานะ ready ขอ token กลางสำหรับ client app-control               |
| C11 | GET    | /connect/:system   | Redirect | ตรวจสิทธิ์/สถานะ แล้วส่ง browser ไป A/B /sso; รองรับ app-a หรือ app-b |
| C12 | GET    | /session/heartbeat | JSON     | ตรวจ C local session ไม่ได้ introspect central token                  |
| C13 | GET    | /                  | HTML     | dashboard และสถานะ SSO                                                |
| C14 | GET    | /users             | HTML     | ผู้ดูแลอ่านรายชื่อผู้ใช้/สิทธิ์                                       |
| C15 | POST   | /users             | Form     | ผู้ดูแลเพิ่มผู้ใช้และ sync Keycloak                                   |
| C16 | POST   | /users/:id         | Form     | ผู้ดูแลแก้ชื่อ/รหัสผ่าน/สิทธิ์/enabled แล้ว sync                      |
| C17 | POST   | /users/:id/sync    | Form     | ผู้ดูแล sync ผู้ใช้ที่มีอยู่ใหม่                                      |
| C18 | POST   | /users/:id/delete  | Form     | ปิดสิทธิ์ sync revoke unlink แล้วลบผู้ใช้ใน C                         |

C05 และ form routes จัดการข้อมูลตรวจ CSRF ตาม middleware; /users ต้องเป็น admin ของ C ด้วย ส่วน C02/C03 ผูกกับ pending request และ C session

C มี GET /oidc/jwks เป็น route ที่เขียนเอง ใช้ public key ชุดเดียวกับ assertion, signed response และ signed logout โดยไม่เปิด private key ไม่มี OIDC authorization-code, consent, /interaction, /sso/redeem หรือ backchannel compatibility routes แล้ว

## Keycloak: protocol/support 5 endpoints

Prefix `K = http://localhost:8080/realms/sso-lab` ภายใน Docker backend เรียก `http://keycloak:8080/realms/sso-lab`

| #   | Method | Path ต่อจาก K                             | ผู้เรียก | หน้าที่                                                                  |
| --- | ------ | ----------------------------------------- | -------- | ------------------------------------------------------------------------ |
| K01 | GET    | /.well-known/openid-configuration         | A/B, C   | Discovery/readiness ตรวจเชื่อมต่อและ issuer                              |
| K02 | GET    | /protocol/openid-connect/certs            | A/B, C   | อ่าน public keys ของ Keycloak; cache ได้                                 |
| K03 | POST   | /protocol/openid-connect/token            | C        | JWT bearer grant สำหรับ user; client_credentials สำหรับ service account  |
| K04 | POST   | /protocol/openid-connect/token/introspect | A/B      | ตรวจ active ของ token ใน heartbeat หรือ protected request ที่ครบช่วงตรวจ |
| K05 | POST   | /protocol/openid-connect/revoke           | C        | revoke token ที่ยังไม่หมดอายุ; ใช้ตอน Logout/ปิดบัญชี/จัดการ race        |

K03 นับเป็น endpoint เดียว แม้ใช้ 2 grant types:

```text
JWT bearer:
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
client_id=app-a | app-b | app-control
client_secret=<server-side secret>
assertion=<C signed JWT>
scope=openid profile email

Service account:
grant_type=client_credentials
client_id=app-control-sync
client_secret=<server-side secret>
```

K04 ใช้ token, client_id, client_secret และ token_type_hint; K05 ใช้รูปแบบเดียวกันเพื่อเพิกถอน ไม่ใส่ secret ใน URL หรือเอกสาร

## Keycloak: Admin API 12 endpoints

Prefix `M = http://localhost:8080/admin/realms/sso-lab` ทุกเส้นด้านล่างถูกเรียกจาก **C backend** ด้วย service-account Bearer token ไม่ใช่ browser ของผู้ใช้

| #   | Method | Path ต่อจาก M                                                | หน้าที่                                               |
| --- | ------ | ------------------------------------------------------------ | ----------------------------------------------------- |
| M01 | GET    | /users                                                       | ค้นหาผู้ใช้ด้วย email และ exact=true                  |
| M02 | POST   | /users                                                       | สร้างบัญชี metadata ไม่มีรหัสผ่าน C                   |
| M03 | PUT    | /users/{userId}                                              | ปรับ email/enabled                                    |
| M04 | GET    | /users/{userId}/federated-identity                           | อ่าน link กับ C                                       |
| M05 | POST   | /users/{userId}/federated-identity/{alias}                   | เชื่อม Keycloak user กับ C user ID; alias=app-control |
| M06 | DELETE | /users/{userId}/federated-identity/{alias}                   | ถอน link ตอนลบผู้ใช้ C                                |
| M07 | GET    | /clients                                                     | ค้นหา app-a/app-b ด้วย clientId                       |
| M08 | GET    | /clients/{clientUuid}/roles                                  | อ่าน definitions read/write/delete                    |
| M09 | GET    | /users/{userId}/role-mappings/clients/{clientUuid}           | อ่าน roles ที่กำหนดโดยตรง                             |
| M10 | POST   | /users/{userId}/role-mappings/clients/{clientUuid}           | เพิ่ม role ที่ยังไม่มี                                |
| M11 | DELETE | /users/{userId}/role-mappings/clients/{clientUuid}           | ถอน role ที่ไม่ควรมี                                  |
| M12 | GET    | /users/{userId}/role-mappings/clients/{clientUuid}/composite | ตรวจ effective roles รวมที่สืบทอดมา                   |

โค้ด **ไม่ได้เรียก DELETE /users/{userId} ของ Keycloak** ตอนลบผู้ใช้ C: ปิดบัญชี ถอน roles, revoke tokens และ unlink ก่อนลบเฉพาะข้อมูล C

12 เส้นนี้มาจาก [keycloak-sync.js](../../app-control/src/services/keycloak-sync.js) ไม่รวม API ที่ผู้ดูแลกดใช้ผ่าน Keycloak Admin Console หรือสคริปต์ตั้งค่าเก่า

## ตัวอย่างจำนวน request จริง

| เหตุการณ์                               | จำนวน request Keycloak โดยไม่รวม refresh กุญแจ                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| Login local A/B                         | 0                                                                                   |
| Login C โดยตรง สำเร็จครั้งแรก           | discovery 1 + token 1 = 2; status polling เป็น browser→C เพิ่มต่างหาก               |
| กด SSO A/B และ Login C ใน relay         | discovery A/B 1 + token ปลายทาง 1 = 2; ไม่ bootstrap token ของ C เพิ่มใน branch นี้ |
| SSO A/B เมื่อมี C session               | discovery 1 + token ปลายทาง 1 = 2                                                   |
| มีสิทธิ์ไม่พอและ C ปฏิเสธก่อน token     | discovery 1; token 0                                                                |
| ไม่มีบัญชี local แต่ C ให้สิทธิ์        | discovery 1 + token 1 แล้ว A/B ปฏิเสธ                                               |
| explicit preflight ติดต่อไม่ได้         | discovery สูงสุด 3; token 0                                                         |
| automatic silent preflight ติดต่อไม่ได้ | discovery 1; token 0                                                                |
| heartbeat token ยังไม่หมดอายุ           | introspection 1 ต่อ heartbeat                                                       |
| heartbeat พบ token หมดอายุแล้ว          | introspection 0; ปฏิเสธจาก exp ในแอป                                                |
| Logout A/B                              | 0                                                                                   |
| Logout C                                | revoke N; ไม่เรียก Admin API หรือขอ service-account token ใน Logout flow            |

N คือจำนวน token ของผู้ใช้ที่ C บันทึกไว้และยังไม่หมดอายุ ไม่ใช่จำนวนแอป เพราะแต่ละ Login อาจขอ token ใหม่ การดึง K02 และ C /oidc/jwks เพิ่มเมื่อ cache ว่าง/refresh; Keycloak อาจอ่าน JWKS ของ C เองด้วย จึงไม่รับประกันจำนวน HTTP request รวมตายตัว

Sync ผู้ใช้ enabled ที่มีบัญชี/link/roles ตรงอยู่แล้ว ใช้ Admin API **11 requests**: ค้นหา user 1 + update 1 + อ่าน links 1 + (ค้นหา client, role definitions, direct roles, effective roles) 4 ต่อแอป × 2 จากนั้นเพิ่ม POST/DELETE ตาม role ที่เปลี่ยนจริง และอาจมี token service account 1 ครั้งเมื่อ cache ว่าง
