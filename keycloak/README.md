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

`POST /bootstrap` และ `/revoke` ตรวจ client credentials ของ authority C ส่วน `/logout-user` ตรวจ signed proof วัตถุประสงค์ sso_logout จาก C โดยไม่รับ client credentials; A/B introspect ด้วย client credentials ของตัวเอง การส่งต่อ `/authorize` ตรวจ signed C proof กับข้อมูล client/callback ที่ลงทะเบียนไว้ ไม่ใช้ client secret ใน browser

Repository ใช้ critical section เดียวสำหรับการใช้ proof/เขียน token/Logout เพื่อรักษาการป้องกัน replay และคำขอที่ค้างหลัง Logout ขอบเขตยังเป็น PoC node เดียว

```sh
docker compose build keycloak
docker compose up -d --no-deps keycloak
npm run test:integration
npm run test:token-menu
npm run test:idp-heartbeat
```

รายละเอียด [settings](../docs/keycloak/SETUP-GUIDE.md) และ [flow](../docs/flows/LOGIN-AND-SESSION.md)

IdP heartbeat อยู่ที่ `heartbeat/IdentityProviderHeartbeatTask` ใช้ TimerProvider ของ Keycloak เปิด session/transaction ใหม่ทุก tick อ่าน `IdpHeartbeatSettings` ของแต่ละ realm และเรียก `IdentityProviderLogoutService` เมื่อพบ IdP down UI อยู่ใน theme โมดูล RealmSettingsSection ของ Keycloak 26.8.1 เดียวกับที่ pin ใน Dockerfile ค่าเวลาแก้ได้ที่ Realm settings → Sessions → Logout; ไม่ต้อง rebuild เพื่อเปลี่ยนช่วงเวลา

รันทดสอบเพิ่มด้วย `npm run test:idp-heartbeat` ตรวจ UI, C ล่มจริง, token ถูก revoke, A/B ถูกแจ้งออก, Login ด้วยบัญชีของระบบ ยังอยู่, heartbeat สำรองและ notification ที่มาช้าหลัง Login ใหม่

## ชนิดข้อมูลที่ REST endpoint รับและส่ง

`@Consumes` ระบุ Content-Type ของ request body ที่ endpoint รับ เช่น `application/x-www-form-urlencoded` สำหรับ assertion/token ส่วน `@Produces` ระบุ Content-Type ของ response เช่น JSON สำหรับ bootstrap/introspect หรือ HTML สำหรับ authorize ทั้งสองเป็น annotations ของ REST ไม่ได้หมายถึงการออก token หรือระบบคิว producer/consumer
