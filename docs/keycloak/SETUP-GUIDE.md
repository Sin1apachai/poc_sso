# ตั้งค่า Keycloak เฉพาะที่จำเป็น

[เหตุผลและ Feature](FEATURES.md) · [ภาพ UI และค่ารายละเอียด](SETUP-REFERENCE.md) · [Flow](../flows/README.md)

ใช้กับโค้ดปัจจุบัน: **C ตรวจรหัสผ่าน → Keycloak ออก token → A/B ตรวจแล้วสร้าง session ของตัวเอง** ไม่ต้องตั้ง browser Login หรือ consent ใน Keycloak

ค่าด้านล่างทดสอบกับ Keycloak 26.8.1 ใน instance แยกแล้ว ไม่ใช่การตั้งค่าให้อัตโนมัติใน realm ของคุณ ภาพใช้ข้อมูลสมมติและปิดบัง secret

## สิ่งที่ต้องมี

| รายการ                  | จำนวน | ใช้ทำอะไร                                |
| ----------------------- | ----: | ---------------------------------------- |
| Realm sso-lab           |     1 | ขอบเขตของ SSO                            |
| IdP app-control         |     1 | เชื่อถือ assertion ที่ C ลงลายเซ็น       |
| Clients app-a / app-b   |     2 | token แยกตามแอป                          |
| Client app-control      |     1 | token ที่ C ขอหลัง Login ตามโค้ดปัจจุบัน |
| Client app-control-sync |     1 | C จัดการ users/roles ผ่าน Admin API      |
| Client roles            |     6 | read/write/delete ของ A และ B            |
| Mappers                 |     8 | audience 3 + idp 3 + permissions 2       |
| Service-account roles   |     2 | manage-users และ view-clients            |

Clients มาตรฐานที่ Keycloak สร้างให้ เช่น account, broker และ realm-management ให้คงไว้ ไม่ต้องลบเพื่อลดจำนวน

Client app-control ยังตัดออกไม่ได้โดยเปลี่ยน settings อย่างเดียว เพราะโค้ด C ยังขอ token ของ client นี้ ไม่ใช่ IdP อีกตัวหนึ่ง

## 1. Realm และอายุ token

**UI:** เลือก realm sso-lab หากยังไม่มีจึงใช้ Manage realms → Create realm

**UI:** Realm settings → Tokens → Access Token Lifespan = **5 Minutes** (300 วินาที)

![ตำแหน่งอายุ access token](images/03-realm-tokens.png)

นี่คืออายุ token กลาง ไม่ใช่ heartbeat 1 ชั่วโมงของแอป ค่า RS256 และกุญแจ rsa-generated ใช้ค่าเริ่มต้นได้ ไม่ต้องสร้างหรือ upload key เพิ่ม

ไม่ต้องปรับ Login screen, Remember me, browser authentication flow, SSO Session Max/Idle หรือ User Federation สำหรับ flow นี้

## 2. เชื่อถือ C ด้วย IdP ตัวเดียว

**UI:** Identity providers → Add provider → JWT Authorization Grant

![IdP ของ C และ fields ที่ต้องตั้ง](images/05-idp-jwt-settings.png)

| Field                            | ค่า                                    |
| -------------------------------- | -------------------------------------- |
| Alias / Enabled                  | app-control / On                       |
| Issuer                           | http://localhost:4003/oidc             |
| Use JWKS URL / JWKS URL          | On / http://app-control:4003/oidc/jwks |
| Allow assertion reuse            | Off                                    |
| Max allowed assertion expiration | 1 Minute                               |
| Assertion signature algorithm    | RS256                                  |
| Limit access token expiration    | Off                                    |

**เหตุผล:** Keycloak ตรวจว่า C เป็นผู้เซ็นจริงและหลักฐานยังใช้ได้ assertion มีอายุ 60 วินาที แต่ token กลางมีอายุ 300 วินาที จึงไม่เปิด Limit access token expiration

Allowed clock skew ใช้ค่าเดิม 0 ได้ Provider ชนิดนี้เปิดรับ JWT grant ในตัว ไม่ต้องหา switch เปิด grant ในหน้า IdP และไม่ต้องกรอก authorization URL หรือ token URL ของ C

## 3. Clients: เปิดเฉพาะ capability ที่ใช้

**UI:** Clients → Create client; เลือก Client type = OpenID Connect แล้วตั้ง Client ID ตามตาราง

**UI:** เลือก client → Settings → Capability config

![ตำแหน่ง capabilities และ Allowed IdP](images/07-client-capabilities.png)

| Client           | Client authentication | JWT Authorization Grant | Allowed IdP | Service accounts roles |
| ---------------- | --------------------- | ----------------------- | ----------- | ---------------------- |
| app-a            | On                    | On                      | app-control | Off                    |
| app-b            | On                    | On                      | app-control | Off                    |
| app-control      | On                    | On                      | app-control | Off                    |
| app-control-sync | On                    | Off                     | ไม่ใช้      | On                     |

ปิด Standard flow, Direct access grants, Implicit flow และ capability อื่นที่ไม่ได้อยู่ในตาราง ไม่ต้องกรอก Redirect URI, Web origins, Require PKCE หรือ Backchannel logout URL สำหรับ flow นี้

## 4. Roles และ scopes

**UI:** Clients → app-a / app-b → Roles → Create role

สร้าง **read, write, delete** แยกใต้ A และ B ไม่ต้องสร้าง application roles ให้ C

**UI:** Clients → เลือก client → Client scopes → ชื่อ client-dedicated → Scope

![Full scope allowed และ role scope](images/12-role-scope.png)

ตั้ง **Full scope allowed = Off ทุก client** แล้วกำหนด:

| Client           | Default client scopes | Roles ใน dedicated Scope                    |
| ---------------- | --------------------- | ------------------------------------------- |
| app-a            | profile, email        | app-a/read, write, delete                   |
| app-b            | profile, email        | app-b/read, write, delete                   |
| app-control      | profile, email        | ไม่ต้องเพิ่ม                                |
| app-control-sync | roles                 | realm-management/manage-users, view-clients |

กด Assign role → Client roles เพื่อเลือก roles ส่วน Default scopes จัดในหน้า Client scopes ของ client นั้น ลบ assigned scopes อื่นที่ไม่ใช้ ไม่ต้องลบ built-in client-scope definitions ของ realm

**เหตุผล:** ผู้ใช้มีสิทธิ์อะไรกับ client ยอมรับสิทธิ์อะไรเป็นคนละชั้น การเพิ่ม role ใน Scope ไม่ได้ให้สิทธิ์ผู้ใช้ทุกคน

A/B/C ใช้ profile/email ตาม scope ที่โค้ดร้องขอ และมี permission mappers เอง จึงไม่ต้องเพิ่ม default roles scope ให้สาม client นี้ ส่วน sync ต้องมี roles เพื่อใส่สิทธิ์ Admin API ใน service token

## 5. Mappers: ใส่ claims ที่โค้ดตรวจจริง

**UI:** Clients → เลือก client → Client scopes → client-dedicated → Mappers → Add mapper → By configuration

| Mapper type      | Clients | ค่าหลัก                                                                                                            |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| Audience         | A, B, C | Included Client Audience = Client ID ของตัวเอง                                                                     |
| Hardcoded claim  | A, B, C | Token Claim Name = idp; Claim value = app-control; JSON Type = String                                              |
| User Client Role | A, B    | Client ID = ตัวเอง; claim = app_permissions.app-a หรือ app_permissions.app-b; Multivalued = On; JSON Type = String |

ทุก mapper เปิด Add to access token ส่วน Add to ID token, userinfo และ lightweight token ปิดไว้ ดูภาพ field แยกทั้งสามแบบใน [คู่มือรายละเอียด](SETUP-REFERENCE.md#7-ตั้ง-protocol-mappers)

Add to token introspection เปิดได้หากต้องการดู claims ผ่าน API แต่ไม่ใช่เงื่อนไข Login ซึ่งตรวจ JWT โดยตรง

**เหตุผล:** โค้ดต้องได้ aud ของแอป, idp=app-control และ permissions เป็น array ไม่ต้องเพิ่ม mapper ของ IdP เอง, script mapper หรือ app_permissions ของแอปอื่น

## 6. ให้ C sync ได้ด้วยสอง roles

**UI:** Clients → app-control-sync → Service account roles → Assign role → Client roles

เลือกจาก client **realm-management** เท่านั้น:

- **manage-users:** ค้นหา/สร้าง/ปรับผู้ใช้ จัด identity link และ role mappings
- **view-clients:** อ่าน clients และ role definitions

![Service-account roles ที่ใช้](images/17-service-account-roles.png)

เพิ่มสอง role นี้ใน dedicated Scope ด้วยตามขั้น 4 ไม่ต้องเพิ่ม query-users เพราะทดสอบใน 26.8.1 แล้ว manage-users ครอบคลุมการค้นหาที่ C ใช้ ไม่ต้องให้ realm-admin หรือ manage-clients

อย่าถอน built-in default role เพียงเพราะชื่อปรากฏในตาราง ให้จำกัด roles ที่ออกใน token ผ่าน Full scope allowed และ role scope ตามขั้น 4

## 7. Secret และ sync ผู้ใช้

**UI:** Clients → เลือก client → Credentials → Client Secret

| Client           | ตัวแปร .env                |
| ---------------- | -------------------------- |
| app-a            | APP_A_KC_CLIENT_SECRET     |
| app-b            | APP_B_KC_CLIENT_SECRET     |
| app-control      | CONTROL_KC_CLIENT_SECRET   |
| app-control-sync | CONTROL_SYNC_CLIENT_SECRET |

หลังใส่ secret ให้รัน:

```sh
docker compose up -d --force-recreate app-a app-b app-control
```

เปิด C → Users → กำหนดสิทธิ์ → Save/Sync ให้สำเร็จ จากนั้นใน Keycloak Users ตรวจว่ามี Identity provider link ของ app-control และ Role mapping ตามที่กำหนดใน C ไม่ต้องตั้ง password ของผู้ใช้ใน Keycloak

A/B ยังต้องมี local user ที่ email ตรงกับ C ด้วย

## ตรวจเสร็จแล้วต้องได้อะไร

1. Login C ขอ token ได้
2. เปิด A/B ผ่าน C ได้ตาม read permission โดยไม่ถาม password C ซ้ำ
3. JWT ของ A มี aud=app-a, idp=app-control และ app_permissions.app-a เป็น array; B เช่นเดียวกัน
4. Logout C revoke token และแจ้ง A/B ให้ออก ส่วน local Login A/B ยังแยกกัน

ค่าข้างต้นทดสอบผ่าน JWT grant, assertion replay rejection, อายุ token 300 วินาที, introspection/revoke และ Admin API ทั้ง 12 templates โดยใช้ service account เพียงสอง roles

อ่าน field/ภาพเพิ่มเติมใน [SETUP-REFERENCE.md](SETUP-REFERENCE.md) และอ่านเหตุผลเชิง feature ใน [FEATURES.md](FEATURES.md)
