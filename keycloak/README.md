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

`StoredCentralToken` มี JWT ภายใน จึงให้ Admin API ใช้เฉพาะ `toMetadata()` ซึ่งเลือกส่ง 8 fields เดิม ไม่มี JWT หรือ secret ติดไปกับตาราง

ชื่อ Java เปลี่ยน แต่ endpoint `/temporary-sso-poc`, `/temporary-sso-tokens`, SPI IDs, realm attributes, claims และ cache namespace คงเดิม A/B/C จึงใช้ config เดิมได้ C ออก token กลางหนึ่งใบ A/B รับใบเดิมผ่านหลักฐานส่งต่อ session ของแอปแยกกัน และไม่มี `/sso/resume`

Repository ยังคง critical section เดียวสำหรับการใช้ proof/เขียน token/Logout เพื่อรักษาการป้องกัน replay และคำขอที่ค้างหลัง Logout ขอบเขตยังเป็น PoC node เดียว

```sh
docker compose build keycloak
docker compose up -d --no-deps keycloak
npm run test:integration
npm run test:token-menu
```

รายละเอียด [settings](../docs/keycloak/SETUP-GUIDE.md) และ [flow](../docs/flows/LOGIN-AND-SESSION.md)
