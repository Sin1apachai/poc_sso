# API และข้อมูลรับส่งของระบบ SSO

อ้างอิง `app/src/routes.js`, `app-control/src/routes.js` และ `keycloak/src/main/java/lab/sso/web/CentralSsoResource.java`

1 endpoint = method + path template Response ไม่นับเป็น request ใหม่ Redirect จะเกิด request เพิ่มเมื่อ browser ตาม URL จำนวนครั้งขึ้นกับ cache, polling และ retry

## A/B — 14 routes ต่อระบบ

| Method/path                  | หน้าที่                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `GET /health`                | ตรวจฐานข้อมูลและสถานะระบบ                                                 |
| `GET /login/local`           | กลับ Login โดยไม่เริ่ม silent SSO ซ้ำ                                     |
| `GET /login`                 | หน้า Login และ modal ที่แจ้งเพียงครั้งเดียว; ครั้งแรกอาจ silent check     |
| `POST /login`                | ตรวจรหัสผ่านของระบบ สร้าง app token/session                               |
| `GET /sso`                   | ตรวจพร้อมแล้วเปิดคำขอ SSO C                                               |
| `POST /sso/preflight`        | ปุ่ม SSO ตรวจพร้อมและส่ง URL C กลับเป็น JSON                              |
| `GET /sso/connectivity`      | อ่านความคืบหน้า retry ระหว่างกด SSO                                       |
| `GET /sso/callback`          | รับ error พร้อม state จาก C/หน้าส่งต่อ                                    |
| `POST /sso/callback`         | รับ JWT จาก Keycloak ตรวจ binding/สิทธิ์/บัญชี และสร้าง app session       |
| `GET /session/logout-events` | SSE สำหรับแจ้ง SSO logout โดยไม่ polling เพิ่ม                            |
| `GET /session/heartbeat`     | ตรวจ session จาก Login หรือ SSO; SSO ใช้ custom introspection ตามเงื่อนไข |
| `POST /logout/control`       | รับ signed logout จาก C หรือ Keycloak ล้าง SSO ตามขอบเขต notification     |
| `GET /`                      | หน้าหลักที่ตรวจ authentication                                            |
| `POST /logout`               | ออกเฉพาะระบบนี้ ตรวจ CSRF และล้าง cookie/session                          |

A/B ใช้โค้ดเดียวกัน รวม **28 routes** Script `/sso-complete.js` เป็น static asset ส่งเพียงสัญญาณสำเร็จไปหน้าส่งต่อ ไม่ส่ง token

## C — 16 routes

| Method/path              | หน้าที่                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `GET /health`            | ตรวจฐานข้อมูล                                                                              |
| `GET /sso/authorize`     | รับ client/state/challenge ตรวจ session C; ไม่มี session แสดงหน้า Login ใน response นี้เลย |
| `GET /login`             | หน้า Login C ปกติ หรือเปิดคำขอที่รออยู่                                                    |
| `POST /login`            | ตรวจรหัสผ่าน สร้าง session C และส่ง proof ต่อใน response เดิม หรือไป dashboard             |
| `GET /oidc/jwks`         | public signing keys ของ C ไม่มี private key                                                |
| `POST /logout/keycloak`  | รับ IdP-scoped logout ที่ Keycloak ลงลายเซ็น ล้างสถานะ token กลางเก่าของ C เมื่อฟื้นตัว    |
| `POST /logout`           | ปิดต้นทาง ขอ Keycloak ยกเลิก token แจ้ง A/B แล้วล้าง session C                             |
| `POST /sso/retry`        | ขอ token กลาง C ใหม่สูงสุด 3 ครั้ง                                                         |
| `GET /sso/status`        | แจ้งความพร้อม SSO และเวลาหมดอายุ โดยไม่ส่ง token ให้หน้าเว็บ                               |
| `GET /connect/:system`   | ตรวจสิทธิ์และความพร้อม ก่อน redirect ไป SSO ของแอป                                         |
| `GET /session/heartbeat` | ตรวจ session Login ของ C                                                                   |
| `GET /`                  | dashboard C และลิงก์ A/B                                                                   |
| `GET /users`             | หน้าจัดการบัญชีและสิทธิ์ เฉพาะ admin                                                       |
| `POST /users`            | เพิ่ม user และสิทธิ์ในฐานข้อมูล C เท่านั้น                                                 |
| `POST /users/:id`        | แก้บัญชี/สิทธิ์ แล้ว revoke และแจ้ง A/B                                                    |
| `POST /users/:id/delete` | ปิดบัญชี revoke/แจ้ง A/B แล้วลบ user C                                                     |

รวม A/B/C **44 routes** รวม HTML, JSON, callback และ SSE ไม่ใช่ JSON APIs ทั้งหมด

## Keycloak runtime — 8 endpoints

Custom base path: `/realms/sso-lab/temporary-sso-poc`

| Method/path                                         | ผู้เรียก                     | ข้อมูลหลักและหน้าที่                                                                          |
| --------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /status`                                       | A/B backend                  | คืน issuer และ temporary_sso เพื่อ preflight                                                  |
| `POST /bootstrap`                                   | C backend                    | C client authentication + assertion purpose sso_bootstrap; ออก token กลางร่วม aud sso-apps    |
| `POST /authorize`                                   | Browser ในเฟรมที่ C เตรียม   | `assertion` ที่ C ลงลายเซ็น; ตรวจและส่ง token กลางใบเดิม พร้อมหลักฐาน handoff ไป callback A/B |
| `GET /submit.js`                                    | Browser                      | ส่งฟอร์ม token เข้า callback A/B ภายในเฟรม                                                    |
| `POST /introspect`                                  | A/B/C backend                | token + client_id + client_secret; ตรวจ JWT อายุและ cache TTL                                 |
| `POST /revoke`                                      | C authority backend เท่านั้น | token + client authentication; ยกเลิก token รายใบ ไม่ผูกปุ่ม Logout A/B                       |
| `POST /logout-user`                                 | C backend                    | signed logout assertion; ลบสถานะ token ผู้ใช้ตาม index และตั้ง cutoff ชั่วคราว                |
| `GET /realms/sso-lab/protocol/openid-connect/certs` | A/B/C backend                | native Keycloak JWKS สำหรับตรวจ JWT กลาง                                                      |

**7 custom endpoints + 1 native JWKS endpoint = 8** ไม่มี native OIDC authorization/token/introspection/revoke/End Session ใน Login/Logout ใหม่นี้ อย่าใช้ native endpoint แทน custom endpoint เพียงเพราะชื่อคล้ายกัน

### ตัวอย่างผล custom introspection

Body ของคำขอเป็น form-urlencoded: `token`, `client_id`, `client_secret` ใช้ secret ของ client ที่ตรวจ เช่น app-b ไม่ใช้ secret ของ app-a แทน

ตัวอย่าง response เมื่อ token ยัง active และ client ผู้ตรวจมี read (ค่าตัวตนและเวลาเป็นข้อมูลสมมติ):

```json
{
  "active": true,
  "sub": "temporary-subject-example",
  "aud": "sso-apps",
  "exp": 1900000000,
  "email": "user@example.com",
  "app_permissions": {
    "app-a": ["read", "write"],
    "app-b": ["read"]
  }
}
```

เมื่อหมดอายุ, revoked, ไม่พบ token ใน cache หรือ client ผู้ตรวจไม่มี read จะได้ `{ "active": false }` ไม่ส่ง claims ทั้งหมดของ JWT กลับมา ส่วน credentials ผิดเป็น HTTP error ไม่ใช่ active=false และการ decode JWT เองไม่ได้ตรวจว่า token ถูก revoke ใน cache แล้วหรือไม่

## การตรวจข้อมูลก่อนสร้าง Session

| ผู้ตรวจ                   | ข้อมูลที่ต้องผ่าน                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| C รับ token จาก bootstrap | ลายเซ็น RS256, issuer, audience, อายุ token, ตัวตน/email, IdP, authority และ bootstrap_generation ตรงกับคำขอ      |
| Keycloak รับหลักฐานจาก C  | ลายเซ็น C, issuer/audience, อายุไม่เกิน 60 วินาที, วัตถุประสงค์ และหลักฐานไม่ถูกใช้ซ้ำ                            |
| A/B รับ token กลาง        | ลายเซ็น RS256, issuer, audience กลาง, อายุ token, IdP, authority และเครื่องหมาย central_shared/temporary_identity |
| A/B รับหลักฐานส่งต่อ      | ลายเซ็น Keycloak, audience ของ client ผู้รับ, state/challenge, sub, central_jti และ token_hash ตรงกับ token/คำขอ  |
| A/B อนุญาตเข้าแอป         | มี read ใน app_permissions ของระบบนั้น และมีบัญชีในฐานข้อมูลแอปที่ email ตรงกัน                                   |

Token กลางไม่มี state/challenge ของแต่ละแอป เพื่อให้ใช้ JWT ใบเดิมได้ หลักฐานส่งต่อมีอายุไม่เกิน 60 วินาทีและไม่เกินเวลาหมดอายุของ token ใช้แทน access token ไม่ได้

## การโหลดกุญแจ

| ผู้เรียก → ปลายทาง | เส้น                                    | เมื่อใด                                                |
| ------------------ | --------------------------------------- | ------------------------------------------------------ |
| Keycloak → C       | `GET /oidc/jwks`                        | ทุกครั้งที่ extension ตรวจ Login/Logout proof          |
| A/B → Keycloak     | `GET .../protocol/openid-connect/certs` | เมื่อต้องตรวจ JWT กลางและ JWKS cache ว่าง/เปลี่ยนกุญแจ |
| A/B → C            | `GET /oidc/jwks`                        | ตรวจ Logout notification เมื่อ JWKS cache ว่าง         |

JWKS เป็น public key ไม่ใช่ Client Secret C ไม่ต้องใช้ A/B client secrets เพื่อสร้าง proof

## Login สำเร็จใช้กี่คำขอ

นับจากกด SSO เมื่อหน้า Login แสดงอยู่แล้ว ไม่รวม initial silent check, polling, CSS, favicon หรือ healthcheck

| กรณี                                  | Browser คำขอหลัก | Script ส่งต่อ | A/B→K preflight | C→K bootstrap | K→C JWKS | A/B→K JWKS | C→K JWKS |
| ------------------------------------- | ---------------: | ------------: | --------------: | ------------: | -------: | ---------: | -------: |
| ยังไม่มี session C (F03)              |                6 |             3 |               1 |             1 |        2 |        0–1 |      0–1 |
| มี C session และ token C ใช้ได้ (F04) |                5 |             3 |               1 |             0 |        1 |        0–1 |        0 |
| มี C session แต่ต้องขอ token C ใหม่   |                5 |             3 |               1 |             1 |        2 |        0–1 |      0–1 |

ตัวเลขปกติเมื่อไม่ retry; JWKS ขึ้นกับ cache ของแต่ละ server Bootstrap หนึ่งครั้งทำให้ Keycloak ตรวจ C proof และ C ตรวจ Keycloak token จึงมีการโหลดกุญแจตามคอลัมน์แยก

F03 browser requests: POST A/B preflight → GET C authorize → POST C login → POST K authorize → POST A/B callback → GET A/B home ระหว่าง C login มี **backend POST bootstrap ภายใน POST login** ไม่ใช่ browser redirect เพิ่ม

Script ส่งต่อ 3 เส้น: C sso-post.js, Keycloak submit.js และ A/B sso-complete.js กดลิงก์จาก C เพิ่ม GET /connect/:system หนึ่งครั้ง

**Login C โดยตรง** มี POST C login และ GET dashboard แล้ว polling /sso/status ตาม UI; C เริ่ม POST bootstrap ทันที ปกติ 1 request และ retry สูงสุด 3 เมื่อ error ชั่วคราว สถานะสำเร็จอ้างอิงผลการได้รับและตรวจ token

C รับ token กลางจาก bootstrap จากนั้น browser POST proof ไป authorize และ Keycloak ส่ง JWT ใบเดิมเข้า A/B โดยตรง ไม่ออก access token เพิ่มและไม่มี code exchange

## Logout / Heartbeat / จัดการสิทธิ์

| งาน                        | Request หลัก                 | หมายเหตุ                                                                    |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Login ด้วยบัญชีของระบบ A/B | K 0                          | อ่านบัญชี/รหัสผ่านของแอป                                                    |
| Heartbeat SSO              | Browser → A/B 1; A/B → K 0–1 | หมดอายุแล้วล้าง session โดยไม่ introspect                                   |
| Logout A/B                 | Browser 3; K 0               | POST logout → GET login/local → GET login                                   |
| Logout C                   | C → K 1; C → A/B 2           | เพิ่ม browser POST logout และ GET login ของแต่ละแท็บ รวมทั้ง JWKS ตาม cache |
| เพิ่ม user C               | K 0                          | ไม่ sync                                                                    |
| แก้/ปิด/ลบ user C          | C → K 1; C → A/B 2           | revoke และให้เริ่ม SSO ใหม่เพื่อรับสิทธิ์ล่าสุด                             |
| Keycloak ล่ม               | preflight สูงสุด 3           | silent 1; ไม่ retry proof เดิมอัตโนมัติ                                     |

## Setup และตรวจผล ไม่ใช่ Login runtime

`lab:configure` ใช้ **11 method/path templates** รวม admin token 1 และ Admin API 10:

- `POST /realms/master/protocol/openid-connect/token`
- `GET /admin/realms`, `POST /admin/realms`, `PUT /admin/realms/{realm}`
- `GET /admin/realms/{realm}/identity-provider/instances`
- `POST /admin/realms/{realm}/identity-provider/instances`
- `PUT /admin/realms/{realm}/identity-provider/instances/{alias}`
- `GET /admin/realms/{realm}/clients`, `POST /admin/realms/{realm}/clients`
- `PUT /admin/realms/{realm}/clients/{id}`
- `GET /admin/realms/{realm}/users/count`

Integration tests เพิ่ม `GET realm` และ `GET client roles` เพื่อตรวจ/คืนค่า ทั้งหมดนี้ไม่ใช่ API ที่ C เรียกเวลาผู้ใช้ Login ไม่สร้าง service account sync หรือ user/role mappings

## ข้อมูลใน proof และ token

Bootstrap proof ใช้ token_use sso_bootstrap และ bootstrap_generation ส่วน A/B proof ใช้ token_use sso_login และ state/challenge

Proof bootstrap มี C subject, email, app_permissions และ bootstrap_generation; proof ส่งต่อ A/B มี central_jti, client/callback และ state/challenge; C session reference, source_issued_ms และ issuer/audience/iat/exp/jti/token_use ลงลายเซ็น RS256 อายุไม่เกิน 60 วินาที ใช้ซ้ำไม่ได้

Token กลางมี issuer/signature ของ Keycloak, stable sub จาก issuer+subject C, aud กลุ่ม SSO จาก config, azp ของ C, exp/iat/jti, email, idp, app_permissions รวม, central_shared และ temporary_identity ส่วน state/challenge, source_issued_ms, central_jti และ token_hash อยู่ในหลักฐาน handoff ที่มี aud ของแอปผู้รับ ไม่มีรหัสผ่าน ไม่มี native Keycloak sid หรือ refresh token sub ไม่ใช่ user row ID ใน Keycloak

ดู [ส่วนขยาย](../../keycloak/src/main/java/lab/sso/web/CentralSsoResource.java), [C proof/logout](../../app-control/src/sso/api-sso.js), [A/B callback](../../app/src/sso/keycloak.js) และ [ผลทดสอบ](TEST-RESULTS.json)

## เมนู SSO Tokens — Admin API เพิ่ม 1 เส้น

`GET /admin/realms/{realm}/temporary-sso-tokens` ใช้ native Admin bearer และต้องมี realm-admin ของ realm เป้าหมาย ไม่ใช้ Client Secret A/B เพื่อขอดูรายการ

Query: `first` เริ่มที่ 0, `max` 1–100 (default 25), `client` อ่านจาก clients ที่เปิด temporary.sso.enabled หรือว่าง (กรองตามผู้ออกคำขอ หรือสิทธิ์ read ของแอป), `search` ค้น email/subject/jti สูงสุด 200 ตัว

Response: `items`, `clients`, `total`, `first`, `max`, `serverTime`; `clients` มี clientId/name/systemId จาก config ปัจจุบัน; แต่ละ item มี `id`, `sub`, `email`, `clientId`, `permissions`, `issuedAt`, `expiresAt`, `status` เท่านั้น ไม่มี JWT/password/secret ใช้ Cache-Control no-store

แสดงเฉพาะ active tokens จาก cache ปัจจุบัน หมดอายุหรือ revoke จะถูกกรองออก ไม่มีการสร้าง user หรือเก็บประวัติถาวร Endpoint นี้แยกจาก Keycloak runtime 8 เส้นของ Login/Logout ด้านบน และไม่เพิ่ม request ใน flow Login A/B/C

ดู [คู่มือเมนูและภาพ UI](../keycloak/SETUP-GUIDE.md) กับ [ผลทดสอบ](../keycloak/TOKEN-MENU-TEST-RESULTS.json)

## Background IdP heartbeat — แยกจาก Login runtime

Keycloak เรียก `GET` IdP Health URL ตามช่วงที่ตั้ง (ค่าเริ่มต้น C `/health` ทุก 60 วินาที) เมื่อไม่ผ่านครบเกณฑ์จะ revoke token แล้ว `POST /logout/control` ไป A/B และ `POST /logout/keycloak` ไป C โดยตรง A/B/C รับ `logout_token` ที่มี token_use idp_logout ลงลายเซ็นโดย Keycloak ไม่ออก access token เพิ่ม ถ้าแจ้งไม่สำเร็จลองใหม่ตามรอบตรวจ โดยคง cutoff ของเหตุการณ์เดิม

UI Sessions → Logout ใช้ native `GET /admin/realms/{realm}` และ `PUT /admin/realms/{realm}` อ่าน/บันทึก realm attributes ไม่เพิ่ม custom settings API การตรวจ Health URL ไม่ใช่การ introspect token ของผู้ใช้ที่ IdP

## Bruno collection

ใช้ [Keycloak runtime collection](../../bruno/keycloak/README.md) มี 7 requests: status, JWKS, bootstrap, authorize, introspect, revoke และ logout-user ไม่รวม submit.js ซึ่งเป็น static asset หรือ Admin CRUD มี scripts สร้าง proof ใหม่และเก็บ token เป็น runtime variable ใช้ตัวตน fixture ไม่แทนการ Login ผ่าน browser
