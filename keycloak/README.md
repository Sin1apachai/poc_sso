# ส่วนขยาย Keycloak สำหรับ token กลาง

โครงสร้าง Java แบ่งหน้าที่และส่ง dependencies ผ่าน constructor จุดประกอบ objects อยู่ใน provider factory แต่ละคำขอได้รับ collaborators ที่อ้าง session/realm ของคำขอนั้น ไม่มีการเก็บ KeycloakSession ใน singleton

| Package / คลาสหลัก                    | หน้าที่                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `provider/`                           | เชื่อม Keycloak SPI และประกอบ objects สำหรับ runtime, Admin API และเมนู    |
| `web/CentralSsoResource`              | รับ HTTP แปลงผลเป็น response ไม่จัดการ cache หรือสร้าง JWT เอง             |
| `web/TokenCatalogResource`            | ตรวจสิทธิ์ realm-admin ก่อนเรียกบริการค้นหา token                          |
| `web/TokenHandoffPage`                | สร้าง HTML ฟอร์มส่ง token ไปแอป                                            |
| `service/CentralTokenService`         | ประสานงานออก token ส่ง token เดิม ตรวจสถานะ และ revoke                     |
| `service/TokenCatalogService`         | กรอง ค้นหา และแบ่งหน้าข้อมูลกำกับ token                                    |
| `security/IdentityAssertionVerifier`  | ตรวจหลักฐานจาก C: ลายเซ็น issuer audience อายุ และวัตถุประสงค์             |
| `security/SsoClientAuthenticator`     | ตรวจ client credentials ผ่าน Keycloak และตรวจว่า client เปิดใช้ SSO        |
| `security/CentralTokenCodec`          | สร้างและลงลายเซ็น JWT กลาง/หลักฐานส่งต่อ และตรวจ JWT กลาง                  |
| `repository/TemporaryTokenRepository` | เก็บข้อมูล TTL ป้องกัน replay และจัดการ logout fence ใน cache              |
| `model/`                              | ตัวตนที่ตรวจแล้ว สิทธิ์แบบ immutable ข้อมูล token ใน cache และข้อมูลส่งต่อ |
| `config/RealmSsoConfiguration`        | อ่าน realm attributes และตรวจ client/system ID                             |

ลำดับเรียก: `Resource → Service → Security / Repository` ส่วน `TokenHandoffPage` รับเฉพาะผลที่ service ตรวจแล้ว Model permissions ไม่ยอมรับ action นอก read/write/delete และไม่เปิดให้แก้ map ภายหลัง

`StoredCentralToken` มี JWT ภายใน จึงให้ Admin API ใช้เฉพาะ `toMetadata()` ซึ่งเลือกส่ง ข้อมูลกำกับ 8 fields ไม่มี JWT หรือ secret ติดไปกับตาราง

`POST /bootstrap` และ `/revoke` ตรวจ client credentials ของ authority C ส่วน `/logout-user` ตรวจ signed proof วัตถุประสงค์ sso_logout จาก C โดยไม่รับ client credentials และคืนจำนวนที่ revoke กับ logout_urls ให้ C ส่งแจ้งตามการตั้งค่า; A/B introspect ด้วย client credentials ของตัวเอง การส่งต่อ `/authorize` ตรวจ signed C proof กับข้อมูล client/callback ที่ลงทะเบียนไว้ ไม่ใช้ client secret ใน browser

Repository ใช้ critical section เดียวสำหรับการใช้ proof/เขียน token/Logout เพื่อรักษาการป้องกัน replay และคำขอที่ค้างหลัง Logout ขอบเขตยังเป็น PoC node เดียว

```sh
docker compose build keycloak
docker compose up -d --no-deps keycloak
npm run test:integration
npm run test:token-menu
npm run test:idp-heartbeat
npm run test:session-logout
```

รายละเอียด [settings](../docs/keycloak/SETUP-GUIDE.md) และ [flow](../docs/flows/LOGIN-AND-SESSION.md)

IdP heartbeat อยู่ที่ `heartbeat/IdentityProviderHeartbeatTask` ใช้ TimerProvider ของ Keycloak เปิด session/transaction ใหม่ทุก tick อ่าน `IdpHeartbeatSettings` ของแต่ละ realm และเรียก `IdentityProviderLogoutService` เมื่อพบ IdP down แท็บ Heartbeat ลงทะเบียนผ่าน `provider/HeartbeatTabProviderFactory` (UiTabProvider) ใน Realm settings ฟอร์ม `HeartbeatSettings.js` ใช้คอมโพเนนต์ของ Admin Console เดิม ได้แก่ FormAccess, SwitchControl, NumberControl, TimeSelectorControl, SelectControl และ FormActions โดย `PageHandler` ส่งหน้าส่วนอื่นให้ handler เดิม ส่วน Health Check URL เพิ่มในโมดูล JWTAuthorizationGrantSettings ของ IdP Settings ทั้งหมดอ้างอิง Keycloak 26.8.1 ที่ pin ใน Dockerfile ค่าเวลาแก้ได้ที่ Realm settings → Heartbeat โดยแยกรอบตรวจปกติจากระยะห่างยืนยันซ้ำ และนับการตรวจไม่ผ่านครั้งแรกรวมในเกณฑ์; ไม่ต้อง rebuild เพื่อเปลี่ยนช่วงเวลา

รันทดสอบเพิ่มด้วย `npm run test:idp-heartbeat` ตรวจ UI, C ล่มจริง, token ถูก revoke, A/B ถูกแจ้งออก, Login ด้วยบัญชีของระบบ ยังอยู่, heartbeat สำรองและ notification ที่มาช้าหลัง Login ใหม่

## Sessions และ Logout targets

`SessionLogoutSettingsService` อ่านรายการ target จาก realm attributes และบันทึกร่วมกับ native session fields ใน transaction เดียว `SessionLogoutSettingsResource` ตรวจ realm-admin และเพิ่ม GET/PUT `/admin/realms/{realm}/sso-session-settings` ส่วน UI `SessionLogoutSettings.js` ใช้ Controller ของฟอร์ม Sessions เดิม มี input Logout URL พร้อม Add/Remove โดยใช้ปุ่ม Save/Revert ชุดเดิม

`patch-sessions.sed` ปรับเฉพาะจุดเชื่อมใน native RealmSettingsSection ของ Keycloak 26.8.1 ระหว่าง build ไม่เก็บสำเนา minified module ใน source และไม่ใช้ DOM portal Runtime อ่านรายการ URLs จาก `RealmLogoutTargets` ที่เก็บใน `temporary.sso.logout-urls` โดยไม่กำหนดจำนวนระบบในโค้ด การอัปเกรดต้องตรวจ anchors และทดสอบ native tabs อีกครั้ง ใช้ `npm run test:session-logout`

## ชนิดข้อมูลที่ REST endpoint รับและส่ง

`@Consumes` ระบุ Content-Type ของ request body ที่ endpoint รับ เช่น `application/x-www-form-urlencoded` สำหรับ assertion/token ส่วน `@Produces` ระบุ Content-Type ของ response เช่น JSON สำหรับ bootstrap/introspect หรือ HTML สำหรับ authorize ทั้งสองเป็น annotations ของ REST ไม่ได้หมายถึงการออก token หรือระบบคิว producer/consumer

`heartbeat/HeartbeatProbe` ใช้ร่วมกันระหว่าง scheduler และปุ่ม **Test heartbeat** ใน Realm settings → Heartbeat ตัวปุ่มเรียก Admin API `POST /admin/realms/{realm}/idp-heartbeat/{alias}/test` ผ่าน `HeartbeatAdminProviderFactory` และ `HeartbeatTestResource` โดยตรวจ realm-admin และอ่าน URL ที่บันทึกไว้ การทดสอบไม่แตะสถานะ monitor หรือ token

Health Check URL เก็บใน IdP config `ssoHealthCheckUrl` ฟอร์มใช้ native Save ของ Identity providers → Settings ส่วน Realm settings → Heartbeat เลือก alias ผ่าน dropdown และเก็บ `temporary.sso.idp-heartbeat.idp-alias` Scheduler อ่าน URL จาก IdP นั้นโดยตรง ข้อความ UI ที่ส่วนขยายเพิ่มใช้ภาษาอังกฤษ Health Check URL อยู่เฉพาะหน้า IdP Settings ส่วนปุ่ม Test heartbeat อยู่ในแท็บ Heartbeat แท็บ Heartbeat ใช้ layout/Save/Revert และ styles ของ Keycloak ไม่ใช้ DOM portal หรือ stylesheet ฟอร์มแยก การอัปเกรด Keycloak ต้องตรวจชื่อโมดูลและ exports ของ Admin Console ที่ theme อ้างอิงใหม่
