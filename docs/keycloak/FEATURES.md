# Feature ของ Keycloak ที่ใช้ใน PoC และเหตุผล

[คู่มือตั้งค่าพร้อมภาพ](SETUP-GUIDE.md) · [รายการ Flow](../flows/README.md)

เอกสารนี้อธิบายพฤติกรรมของโค้ดปัจจุบัน C ตรวจรหัสผ่านและเก็บสิทธิ์ต้นทาง Keycloak ตรวจหลักฐานจาก C และออก JWT ส่วน A/B ตรวจ JWT ก่อนสร้าง session ของตัวเอง

## 1. Realm: พื้นที่แยกความเชื่อถือ

Realm รวม users, clients, roles, IdPs, keys และ token policy เป็นหนึ่งขอบเขต เราใช้ sso-lab สำหรับแล็บ และเก็บ master สำหรับผู้ดูแล Keycloak

**ทำไมตั้งแบบนี้:** issuer ของ token จะมีชื่อ realm เช่น http://localhost:8080/realms/sso-lab ซึ่ง A/B ตรวจแบบตรงตัว ถ้าสร้าง client ใน master แต่แอปชี้ sso-lab จะได้ invalid_client แม้ชื่อ client เหมือนกันก็ตาม

Realm ไม่ใช่ฐานข้อมูลของ A/B/C และไม่ใช่ Docker network

## 2. Identity Provider: ความเชื่อถือที่มีต่อ C

IdP alias app-control แทน C เพียงตัวเดียว ในคู่มือนี้เลือก provider type **JWT Authorization Grant** เพราะ C หลัง cleanup ไม่เปิด authorization-code, token หรือ consent endpoints แบบ OIDC server แล้ว เหลือเพียง JWKS สำหรับตรวจหลักฐานที่ C เซ็นเอง

**ทำไมไม่เลือก provider แบบ OIDC แล้วใส่ /oidc/auth:** โค้ดปัจจุบันไม่มี endpoint นั้น การขอ token กลางทำที่ token endpoint ของ Keycloak ด้วย assertion แทน การใช้ JWT-specific provider จึงไม่ต้องกรอก authorization/token URL ที่ไม่ได้ใช้

ค่าที่ประกอบความเชื่อถือ:

- Alias: app-control ใช้ใน client allowlist และ federated identity link; ต้องตรงกัน
- Issuer: http://localhost:4003/oidc ต้องตรงกับ iss ใน assertion จาก signing code; ไม่จำเป็นต้องเป็นหน้าเว็บที่เปิดได้
- JWKS URL: http://app-control:4003/oidc/jwks เป็น URL ที่ Keycloak ภายใน Docker ไปอ่าน public key ได้
- Enabled: On อนุญาตให้ใช้ IdP นี้

**ข้อจำกัด:** แค่มี IdP ยังขอ token ไม่ได้ ต้องมี client ที่อนุญาต grant นี้ และ user ที่ผูกกับ C ไว้แล้ว

## 3. JWT Authorization Grant: เปลี่ยนหลักฐานเป็น central token

C ตรวจ password กับ bcrypt ใน DB ของตัวเอง แล้วสร้าง JWT assertion โดยมี issuer C, subject เป็น C user ID, audience เป็น realm Keycloak, exp 60 วินาที และ jti ไม่ซ้ำ C ลงลายเซ็น RS256 แล้ว POST ไป Keycloak ด้วย grant_type JWT bearer

**ทำไมใช้:** ให้ Keycloak ตรวจหลักฐานที่ลงลายเซ็นและออก token กลาง โดยไม่ส่ง password ของผู้ใช้ให้ Keycloak และไม่ต้องพา browser ไป authorization endpoint ของ Keycloak

ค่าที่เราตั้ง:

| ค่า                              | ตั้งเป็น                         | เหตุผล                                                                         |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| JWT Authorization Grant          | เปิดโดย provider ชนิดนี้อยู่แล้ว | ไม่ต้องหา switch ของ OIDC provider ในหน้านี้; client ยังต้องเปิด grant         |
| Allow assertion reuse            | Off                              | assertion เดิมใช้ซ้ำไม่ได้; C สร้าง jti ใหม่ต่อคำขอ                            |
| Max allowed assertion expiration | 60 seconds                       | จำกัดระยะเวลาของหลักฐานที่ใช้ขอ token; สอดคล้อง .setExpirationTime("60s") ใน C |
| Assertion signature algorithm    | RS256                            | รับเฉพาะลายเซ็นชนิดที่โค้ด C ใช้                                               |
| Allowed clock skew               | 0 ตามค่าแล็บ                     | ใช้เวลาเครื่องเดียวกัน; ไม่เพิ่มช่วงยอมรับโดยไม่มีเหตุผล                       |
| Limit access token expiration    | Off                              | assertion 60 วินาทีใช้ยืนยันคำขอ ส่วน access token มีอายุ 300 วินาทีตาม realm  |

อายุ assertion กับอายุ access token เป็นคนละเรื่อง หากเปิด Limit access token expiration token กลางอาจสั้นเหลือไม่เกินอายุ assertion และหมดเร็วกว่า 5 นาทีที่คาดไว้

**สิ่งที่ grant นี้ไม่มี:** ไม่ออก refresh token และไม่สร้าง Keycloak browser SSO cookie เป็นแหล่งหลักของการ Login ข้ามแอป การไม่ถามรหัสผ่านซ้ำอาศัย C session ส่วน token ของแต่ละ client ออกแยกใบ

อ้างอิง: [JWT Authorization Grant ของ Keycloak](https://www.keycloak.org/securing-apps/jwt-authorization-grant)

## 4. Confidential client: ตัวตนของ backend

Clients app-a, app-b และ app-control เป็น confidential clients เปิด Client authentication และใช้ client secret ตอน C ขอ token ในนาม client ปลายทาง ชื่อ client เป็น audience ที่แอปนั้นยอมรับ

**ทำไมแยก client:** token สำหรับ A ต้องไม่ถูกนำไปใช้เป็น token สำหรับ B; A/B ตรวจ aud เทียบ KC_CLIENT_ID ของตัวเอง นอกจากนี้แต่ละ client มี roles และ mappers ของตัวเอง

**ทำไม C เก็บ secret ของ A/B ด้วย:** โค้ด C เป็นผู้ยิง token endpoint สำหรับแอปปลายทางโดยตรง จึงต้องมี credentials ของ client นั้น ฝั่ง A/B ก็ใช้ credentials ของตัวเองตอน introspection ขอบเขตความเชื่อถือของ C จึงครอบคลุมการขอ token ให้แอปเหล่านี้

เปิดเฉพาะ JWT Authorization Grant สำหรับสาม client นี้ และเลือก Allowed Identity Providers เป็น app-control เท่านั้น ปิด Standard flow, Direct access grants, Implicit flow, Service accounts roles และ grant อื่นที่ไม่ใช้

Standard flow คือ authorization-code browser flow; Direct access grants คือส่ง user/password ขอ token ที่ Keycloak; Service accounts เป็นตัวตนโปรแกรม ทั้งสามอย่างนี้ไม่ใช่วิธี Login ผู้ใช้ในแอปปัจจุบัน

## 5. Service account: ตัวตนสำหรับ sync ข้อมูล

Client app-control-sync ใช้ client_credentials เพื่อให้ C เรียก Admin API จัดการบัญชี/identity links/role mappings โดยไม่ใช้บัญชี admin ของคนเป็น credentials ในแอป

เปิด Client authentication และ Service accounts roles เท่านั้น ไม่ต้องเปิด JWT grant หรือ Standard flow

กำหนด client roles ของ realm-management ให้ service-account user:

| Role         | โค้ดใช้เพื่ออะไร                                                   |
| ------------ | ------------------------------------------------------------------ |
| query-users  | ค้นหาผู้ใช้ตาม email                                               |
| manage-users | สร้าง/ปรับบัญชี ผูกหรือถอน federated identity และจัด role mappings |
| view-clients | อ่าน client IDs และ role definitions                               |

ไม่ต้องให้ realm-admin เพราะจะได้อำนาจจัดการทั้ง realm เกินงานนี้ และไม่ต้องให้ manage-clients เพราะ C ไม่ได้สร้าง/แก้ client configuration ตอน sync

**สองชั้นที่ต้องผ่าน:** role ต้องถูก assign ให้ service-account user และต้องอยู่ใน role scope ของ client ด้วย ไม่ใช่แค่เห็น role ในหน้า service account แล้ว token จะมีเสมอ เราปิด Full scope allowed และใส่ scope เฉพาะสาม role นี้

manage-users ยังเป็นสิทธิ์ที่กว้างพอจัดการผู้ใช้ใน realm; ชุดนี้เป็นสิทธิ์ที่ใช้กับ PoC ไม่ได้อ้างว่าเป็นการจำกัด admin แบบละเอียดที่สุดสำหรับระบบจริง

## 6. Users และ Federated identity link: เชื่อม ID คนละระบบ

C user ID กับ Keycloak sub ไม่ใช่ค่าเดียวกัน ตัวอย่าง:

```text
C users.id = docs-user-001 (ตัวอย่างในการทดสอบคู่มือ)
       ↓ federated identity: alias app-control, userId docs-user-001
Keycloak users.id = UUID ที่ Keycloak สร้าง
       ↓
central token sub = UUID ของ Keycloak
```

ในแอปจริง C users.id เป็นเลข BIGSERIAL โค้ดแปลงเป็น string ก่อนใส่ assertion sub; ตัวอย่างบัญชีจำลองในภาพไม่ใช่ ID ของฐานข้อมูล C จริง

**ทำไมต้องมี link ก่อน:** Keycloak ใช้ assertion sub หา external identity ภายใต้ IdP แล้วจึงทราบว่าจะออก token ให้ Keycloak user UUID ใด แค่มี email ตรงกันไม่ได้ทำให้ grant ผูกบัญชีให้อัตโนมัติ

C syncUser สร้าง metadata ของ user และ link ผ่าน Admin API ไม่มีการสร้าง password credential ใน Keycloak หลังล้าง realm ต้อง sync อีกครั้งเพื่อให้ kc_user_id ใน DB ของ C อัปเดตเป็น UUID ใหม่

## 7. Client roles และ role mappings: นิยามสิทธิ์กับการให้สิทธิ์

Client role คือรายการสิทธิ์ที่มีได้ เราสร้าง read, write, delete แยกใต้ app-a และ app-b รวม 6 role definitions ส่วน role mapping คือผู้ใช้คนใดได้รับ role ใด

**ทำไมต้องเป็น client roles:** read ของ A กับ read ของ B เป็นคนละสิทธิ์ การใช้ realm role ชื่อ read ตัวเดียวจะไม่บอกว่าเป็นสิทธิ์ของระบบใด

- read เป็นเงื่อนไขที่โค้ด A/B ใช้ยอมให้เข้าแอป
- write/delete แสดงใน token ตามที่เลือกใน C; PoC ยังไม่มี CRUD API ทุกแบบที่บังคับใช้สองสิทธิ์นี้
- การให้ write โดยไม่มี read ไม่ทำให้ผ่าน Login เพราะโค้ดตรวจ read โดยตรง

ให้ผู้ดูแลกำหนดที่ C แล้ว sync เข้า Keycloak ไม่ควรเพิ่ม grants ผ่าน groups/composite ใน Keycloak ควบคู่แบบไม่มีแผน เพราะ C ตรวจ effective roles และรายงาน error หากยังได้รับสิทธิ์ที่ C ไม่ได้อนุญาตผ่านแหล่งอื่น

## 8. Client scopes และ role scope mappings: ข้อมูลที่ client รับได้

Role assignment บอกว่าผู้ใช้มีสิทธิ์อะไร Role scope บอกว่า client ยอมรับสิทธิ์อะไรใน token สุดท้ายเป็นขอบเขตที่ตัดกัน จึงต้องตั้งทั้งคู่

ตั้ง Full scope allowed = Off เพื่อไม่เปิดกว้างให้ทุก role ที่ผู้ใช้มี แล้วกำหนด:

| Client           | Role scope ที่ให้                                        |
| ---------------- | -------------------------------------------------------- |
| app-a            | app-a/read, app-a/write, app-a/delete                    |
| app-b            | app-b/read, app-b/write, app-b/delete                    |
| app-control      | ไม่ต้องใส่ application roles; ใช้ตรวจสถานะ SSO ของ C     |
| app-control-sync | realm-management/query-users, manage-users, view-clients |

เพิ่ม read/write/delete ใน scope ของ app-a ไม่ได้ให้ผู้ใช้ทุกคนมีสิทธิ์เหล่านั้น ผู้ใช้ยังต้องถูก assign ผ่าน C

ให้ default client scopes profile, email, roles อยู่ด้วย: email mapper ให้ email ที่โค้ดต้องใช้; roles scope ให้ข้อมูล roles ของ service account ใน Admin token การถอด roles ออกอาจทำให้ service token ไม่มี resource_access แล้ว Admin API ตอบ 403

## 9. Protocol mappers: แปลงข้อมูลเป็น claims

Mappers ทำงานตอนออก token ไม่ได้ตรวจรหัสผ่านหรือไปถาม A/B ว่ามีบัญชีไหม สำหรับ A/B ใช้ 3 mapper ต่อ client ส่วน C ใช้ 2 mapper

### Audience mapper

Included Client Audience เป็นชื่อ client ตัวเอง เช่น app-a และ Add to access token = On ทำให้ aud มี app-a ซึ่ง A ตรวจ ถ้าไม่มี audience นี้แม้ลายเซ็นถูกต้อง A ก็ปฏิเสธ

### Hardcoded claim mapper

Token Claim Name = idp, Claim value = app-control, Claim JSON Type = String และ Add to access token = On

**ทำไม hardcode:** grant นี้รับได้เฉพาะ C ตาม allowlist ของ client อยู่แล้ว และไม่อาศัย broker browser session note โค้ดตรวจ idp เท่ากับ app-control หากอนาคตเพิ่มหลาย IdP ต้องออกแบบ mapper นี้ใหม่ ไม่คงค่า C ให้ทุก IdP

### User Client Role mapper

เลือก client ตัวเอง, Token Claim Name = app_permissions.app-a หรือ app_permissions.app-b, Claim JSON Type = String, Multivalued = On, Add to access token = On

Multivalued ทำให้เป็น array แม้มีสิทธิ์เดียว และจุดใน claim name ทำให้เกิด JSON object ซ้อนตามรูปแบบที่โค้ดอ่าน:

```json
{
  "idp": "app-control",
  "aud": "app-a",
  "app_permissions": { "app-a": ["read", "write"] }
}
```

JSON Type String หมายถึงชนิดของสมาชิกใน array ไม่ได้หมายถึง stringify object ทั้งก้อน Add to token introspection เปิดด้วยเพื่อดู claims ได้เมื่อใช้ introspection; userinfo และ ID token ไม่ต้องเปิดสำหรับ flow นี้

Dedicated client scope เป็นพื้นที่เก็บ mappers/scopes ของ client นั้นโดยเฉพาะ ไม่ใช่ client อีกตัวที่ต้องสร้างเพิ่ม

## 10. Keys, RS256, kid และ JWKS: ตรวจต้นทางของข้อมูล

มี 2 ชุดกุญแจที่เป็นคนละเจ้าของ:

1. C ลงลายเซ็น assertion, response envelope และ logout notification ด้วย private key ใน secrets/app-control-jwks.json; Keycloak และ A/B อ่าน public key ผ่าน C /oidc/jwks
2. Keycloak ลงลายเซ็น central access token ด้วย realm RSA key; A/B และ C อ่าน public key ผ่าน Keycloak certs endpoint

RS256 ใช้ private key เซ็นและ public key ตรวจ kid เป็นตัวระบุกุญแจใน JWKS ไม่ใช่ user ID หรือ secret

ใช้กุญแจ rsa-generated ที่ Keycloak สร้างให้ได้ในแล็บ ไม่ต้องนำ private key ของ C ไปใส่ใน Realm keys และอย่า regenerate C key ทุกครั้งที่ restart เพราะตัวตรวจอาจ cache กุญแจเดิม และ assertions/tokens ที่ค้างจะไม่ตรงกัน

## 11. Token lifetime, transient sessions และ heartbeat

Realm Access Token Lifespan = 5 นาที (300 วินาที) เป็นค่าตั้งต้นตาม PoC ปัจจุบัน ไม่ใช่ 15 นาทีของเอกสารรุ่นเก่า หากเปลี่ยนเป็น 15 นาทีต้องตั้ง 900 วินาทีและทดสอบใหม่ อย่าสับสนกับ heartbeat ทุก 1 ชั่วโมงของแอป

**ทำไม 5 นาที:** ตรงกับค่าที่ใช้อ้างอิงและทดสอบในแล็บ การมี heartbeat 1 ชั่วโมงไม่ได้ขยาย exp ของ token หากเปิดหน้าค้างไว้จะตรวจในรอบ heartbeat แต่ protected request ที่เกิดก่อนก็ตรวจ exp เองด้วย

JWT grant ใช้ transient sessions และไม่ออก refresh token จึงไม่ใช้ Realm SSO Session Max/Idle เป็นตัวควบคุมอายุ session ของ A/B/C แอปมี local session 1 ชั่วโมงของตัวเอง และ SSO app token มีอายุไม่เกิน central token

หน้า Sessions ใน Keycloak อาจไม่แสดง persistent session แบบ browser Login; การไม่เห็นรายการไม่ได้แปลว่า token ไม่เคยถูกออก ให้ดู introspection และ registry ใน C แทน

## 12. Introspection และ revocation: ตรวจสถานะและเพิกถอน

A/B ตรวจ signature/issuer/audience/expiry เองตอน Login โดยใช้ JWKS ไม่ introspect รอบแรก Heartbeat เรียก introspection เมื่อ JWT ยังไม่หมดอายุ; active=false ทำให้ Logout หาก exp ผ่านไปแล้วแอปปฏิเสธได้ก่อนเรียก API

Logout C อ่าน token registry เรียก revoke สำหรับ token ที่ยังไม่หมดอายุ แล้วส่ง signed logout ไป A/B ให้ล้าง app sessions และแจ้ง browser ผ่าน SSE การ revoke JWT ไม่ลบ cookie ของ A/B ให้เอง จึงต้องมี notification นี้

ไม่ตั้ง Backchannel logout URL ใน Keycloak สำหรับแอปนี้ เพราะโค้ด compatibility endpoint ถูกลบแล้ว เส้นที่ใช้จริงคือ C backend → A/B POST /logout/control ซึ่งตรวจ C signed notification ไม่ใช่ OIDC backchannel token ของ Keycloak

## 13. สิ่งที่ไม่ต้องตั้งใน scope นี้

- User Federation LDAP/AD หรือ User Storage SPI: รหัสผ่านอยู่ใน DB ของ C
- Browser authentication flow, IdP redirector และ First broker login flow: ไม่มีการใช้ Keycloak browser authorization endpoint
- OIDC discovery/auth/token endpoints ของ C: ไม่ได้เปิดในโค้ดหลัง cleanup
- Consent screen: การ Login ไม่ผ่าน C OIDC authorization flow แล้ว
- Redirect URI, Web Origins, PKCE capability ที่ Keycloak client: ไม่ใช้ใน JWT grant นี้; state/challenge ใน A/B↔C เป็นกลไกของแอปที่แยกจาก Keycloak
- Offline access, refresh token rotation, token exchange และ Authorization Services: ยังไม่ใช้
- Script mapper หรือ Java SPI: ไม่จำเป็นสำหรับรูปแบบ claims ปัจจุบัน

อ้างอิงเพิ่มเติม: [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html) และโค้ด [api-sso.js](../../app-control/src/sso/api-sso.js), [keycloak-sync.js](../../app-control/src/services/keycloak-sync.js), [A/B token validation](../../app/src/sso/keycloak.js)
