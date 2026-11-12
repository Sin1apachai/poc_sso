# ระบบ Single Sign-On — A/B/C และ Keycloak

ระบบ C ดูแลบัญชีผู้ใช้และสิทธิ์การเข้าถึงแอป Keycloak ตรวจหลักฐานจาก C และออก token กลาง ส่วน A/B ตรวจ token สิทธิ์ และบัญชีในฐานข้อมูลของตัวเองก่อนสร้าง session

ผู้ใช้เลือก **Login** ด้วยบัญชีของ A/B หรือ **Login SSO** ผ่าน C ได้ แต่ละระบบมี session ของตัวเอง เมื่อเข้าใช้งานผ่าน SSO จะใช้ token กลางใบเดียวกันในรอบนั้น โดยไม่มีการคัดลอกบัญชีหรือรหัสผ่านของ C ไปเก็บใน Keycloak

## คู่มือ

| เอกสาร                                            | เนื้อหา                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| [กระบวนการทำงาน](docs/flows/LOGIN-AND-SESSION.md) | Sequence diagram และ Flowchart ของ Login, SSO, Logout และกรณีขัดข้อง |
| [รายการ API](docs/flows/API-CATALOG.md)           | Endpoint, ข้อมูลรับส่ง และจำนวนคำขอ                                  |
| [ตั้งค่า Keycloak](docs/keycloak/SETUP-GUIDE.md)  | Feature ที่ใช้ ขั้นตอนตั้งค่า เหตุผล และภาพหน้าจอ                    |
| [ส่วนขยาย Java](keycloak/README.md)               | โครงสร้างและหน้าที่ของแต่ละส่วน                                      |
| [Bruno collection](bruno/keycloak/README.md)      | ทดสอบ API Keycloak ที่ระบบใช้งาน                                     |

## หน้าที่แต่ละระบบ

| ส่วน     | หน้าที่                                                              |
| -------- | -------------------------------------------------------------------- |
| A/B      | ตรวจบัญชีของระบบ หรือรับ SSO แล้วตรวจสิทธิ์และบัญชีก่อนสร้าง session |
| C        | ยืนยันตัวตน เก็บบัญชีและสิทธิ์ read/write/delete และขอ token กลาง    |
| Keycloak | ตรวจหลักฐาน ออก token เก็บสถานะชั่วคราว และเพิกถอน token             |
| Browser  | ถือ cookie ของแต่ละระบบและส่งแบบฟอร์มระหว่าง C, Keycloak และ A/B     |

## ติดตั้งและเริ่มใช้งาน

ต้องมี Docker และ Node.js คำสั่งทั้งหมดรันจาก root ของ repo ตัวอย่างใช้ค่าของสภาพแวดล้อมพัฒนาใน .env.example และ Compose หากมี .env หรือกุญแจอยู่แล้วให้ใช้ไฟล์เดิม

```sh
cp .env.example .env
# ตั้งรหัสฐานข้อมูลและ session secrets ใน .env ก่อนเริ่มระบบ
npm ci
npm --prefix app ci
npm --prefix app-control ci
npm run keys:generate
npm run lab:prepare
docker compose up -d --build
npm run lab:configure
```

`lab:prepare` สร้าง Client Secrets เมื่อยังไม่มี ส่วน `lab:configure` ตั้งค่า realm, trust C และ clients ตามสคริปต์ การรันซ้ำจะเขียนค่าที่กำหนดในสคริปต์ทับการตั้งค่าผ่าน UI อ่าน [รายละเอียดการตั้งค่า](docs/keycloak/SETUP-GUIDE.md) ก่อนปรับค่าเอง

A/B ต้องมีบัญชีที่ email ตรงกับ C ตัวอย่างสร้างบัญชีสำหรับทดสอบ:

```sh
printf '%s' 'admin-a-demo' | docker compose exec -T app-a node src/create-user.js admin@example.com
printf '%s' 'admin-b-demo' | docker compose exec -T app-b node src/create-user.js admin@example.com
```

หาก email มีอยู่แล้ว คำสั่งจะไม่เขียนทับรหัสผ่านเดิม

| ระบบ           | URL                         | บัญชีสำหรับสภาพแวดล้อมพัฒนา                           |
| -------------- | --------------------------- | ----------------------------------------------------- |
| A              | http://localhost:4001/login | admin@example.com / admin-a-demo หลังสร้างตามตัวอย่าง |
| B              | http://localhost:4002/login | admin@example.com / admin-b-demo หลังสร้างตามตัวอย่าง |
| C              | http://localhost:4003/login | admin / admin-c                                       |
| Keycloak Admin | http://localhost:8080/admin | admin / admin-local-demo                              |

## พฤติกรรมสำคัญ

- Login A/B ใช้บัญชีของระบบ ไม่สร้าง token กลางและไม่ทำให้เข้าแอปอื่นอัตโนมัติ
- Login C สำเร็จแล้วเริ่มขอ token กลาง เมื่อได้รับและตรวจผ่านจึงแสดงว่า SSO พร้อมใช้งาน
- Login SSO ตรวจสิทธิ์ read และบัญชี A/B ที่ email ตรงกัน หากไม่ผ่านจะกลับ Login พร้อม modal
- เปิดแอปเพิ่มผ่าน SSO ใช้ token กลางใบเดิมและไม่เริ่มนับอายุใหม่
- Logout A/B ออกเฉพาะระบบนั้น ส่วน Logout C ยกเลิก token ของผู้ใช้และแจ้งปลายทางตาม Realm settings → Sessions → Logout ให้ออกจาก SSO การลบ URL แล้ว Save หยุดการแจ้งทันที แต่แอปนั้นยังตรวจพบ token ถูก revoke จาก heartbeat ได้
- Keycloak ตรวจ C ตามรอบปกติ และใช้ระยะห่างยืนยันซ้ำเมื่อพบปัญหา ตั้งจำนวนครั้ง เวลาทั้งสอง และเลือก IdP ได้ใน Realm settings → Heartbeat ส่วน Health Check URL ตั้งใน Identity providers → Settings หาก C ขัดข้องครบเกณฑ์ จะยกเลิก token และแจ้งแอปโดยตรง
- เมื่อถึงรอบตรวจแล้ว Keycloak ติดต่อไม่ได้ A/B ล้าง session SSO และกลับ Login พร้อมแจ้งข้อผิดพลาด ส่วน Login ด้วยบัญชีของ A/B เองยังคงใช้ได้

**Clients ยังใช้ใน Login SSO** สำหรับยืนยันแอปและตรวจ handoff แต่ Client scopes ของ A/B/C ว่าง เพราะส่วนขยายสร้าง claims เอง การไม่ระบุ Client ID ใน Logout URLs ไม่ได้ยกเลิก Clients ของ Login

**ส่วนที่เพิ่มได้แบบ dynamic ตอนนี้คือ Logout URLs ของ Keycloak** ส่วนทะเบียนแอป สิทธิ์ และหน้าจอ C ยังระบุ A/B ดู [ขอบเขตและจุดที่ยังผูกกับ A/B](docs/keycloak/SETUP-GUIDE.md#การเพิ่มแอปและค่าที่อ่านจากการตั้งค่า)

## ข้อมูลและอายุ Session

บัญชีและ session ของ A/B/C อยู่ PostgreSQL แยกฐานข้อมูล ส่วน Keycloak ใช้ H2 ใน volume keycloak_data เก็บการตั้งค่าและกุญแจ ตัวตนกับสถานะ token กลางอยู่ใน cache ชั่วคราวของส่วนขยาย

Session จาก Login ด้วยบัญชีของแต่ละระบบมีอายุสูงสุด 1 ชั่วโมง ส่วน session SSO ของ A/B ใช้ได้ไม่เกิน token กลาง ปกติ 15 นาที ไม่มี refresh token Browser ตรวจ session SSO ตาม `.env` ของแต่ละแอป ค่าเริ่มต้นทุก 2 นาที และระบบตรวจอายุ token เมื่อมีคำขอใช้งาน กำหนดแยกด้วย `APP_A_HEARTBEAT_INTERVAL_SECONDS` / `APP_B_HEARTBEAT_INTERVAL_SECONDS` ดู [ขั้นตอนตั้งรอบ heartbeat](docs/keycloak/SETUP-GUIDE.md#ตั้งรอบ-heartbeat-ab-ผ่าน-env)

Token ของแอปและ token กลางเก็บฝั่ง server Browser ถือ cookie อ้างอิง session A/B เก็บ token กลางที่ `public.session` → JSON `sess.sso.accessToken` ในฐานข้อมูลของตัวเอง ดู [วิธีเชื่อม PostgreSQL และ query token](docs/keycloak/SETUP-GUIDE.md#เชื่อม-postgresql-และหา-token-ที่-ab-เก็บไว้) รายละเอียด session อยู่ใน [อายุ session และ cookies](docs/keycloak/SETUP-GUIDE.md#อายุ-session-cookies-และแหล่งเก็บข้อมูล)

## ตรวจสอบและทดสอบ

```sh
npm run check
npm test
npm run format:check
npm run test:integration
npm run test:token-menu
npm run test:idp-heartbeat
npm run test:session-logout
```

ชุดทดสอบ Browser ใช้ Google Chrome บน macOS ตาม path ที่กำหนดในสคริปต์ รายงานแยกตามขอบเขต:

| ชุดทดสอบ            | สิ่งที่ตรวจ                                                  | รายงาน                                                                      |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| test:integration    | Login, SSO, สิทธิ์, Logout, อายุ token และ Keycloak ขัดข้อง  | [ผลทดสอบกระบวนการ](docs/flows/TEST-RESULTS.json)                            |
| test:token-menu     | สิทธิ์ผู้ดูแล ตัวกรอง และรายการ token                        | [ผลทดสอบเมนู](docs/keycloak/TOKEN-MENU-TEST-RESULTS.json)                   |
| test:idp-heartbeat  | ตั้งรอบตรวจ C, C ขัดข้อง และการแจ้ง Logout                   | [ผลทดสอบ heartbeat](docs/keycloak/IDP-HEARTBEAT-TEST-RESULTS.json)          |
| test:session-logout | Add/Remove URLs, Save/Revert และ Logout C ตาม URLs ที่บันทึก | [ผลทดสอบ Sessions / Logout](docs/keycloak/SESSION-LOGOUT-TEST-RESULTS.json) |

เพิ่ม/ลบปลายทาง logout ได้ที่ **Realm settings → Sessions → Logout** ด้วย Logout URL แล้วใช้ Save/Revert ชุดเดิม อ่าน [คู่มือ](docs/keycloak/SETUP-GUIDE.md) และ [ผลทดสอบ Sessions / Logout](docs/keycloak/SESSION-LOGOUT-TEST-RESULTS.json)

Integration tests ใช้บริการจริงใน Compose โดยหยุด/เปิด Keycloak หรือ C ตามกรณีทดสอบ เตรียม Logout URLs ของ A/B/C ชั่วคราวตามกรณี แล้วคืนรายการ URL และค่าที่เปลี่ยนหลังจบ การทดสอบรอบเวลาเร่งจากฝั่ง test ไม่ได้รอครบรอบ heartbeat จริง ใช้กับสภาพแวดล้อมทดสอบและบัญชีตัวอย่างนี้

## โครงสร้าง

```text
app/                       # โค้ดร่วม A/B แยก config ฐานข้อมูลและ session
app-control/               # C: บัญชี สิทธิ์ และการยืนยันตัวตน
keycloak/                  # ส่วนขยาย Java และ Admin theme
postgres/                  # การสร้างฐานข้อมูล A/B/C
scripts/                   # ตั้งค่า สร้างกุญแจ และทดสอบ
bruno/keycloak/             # Collection สำหรับ API Keycloak
docs/flows/                # กระบวนการและ API
docs/keycloak/             # คู่มือตั้งค่าและภาพหน้าจอ
```

## ขอบเขตการใช้งาน

ชุดติดตั้งนี้เป็น PoC แบบ Keycloak node เดียว ใช้ HTTP localhost และผูกกับ Keycloak 26.8.1 ยังไม่ได้ทดสอบ HA หรือการส่งแจ้งเตือนแบบคงอยู่ข้ามการเริ่มระบบใหม่ สิทธิ์ write/delete ใช้แสดงข้อมูลใน token ยังไม่มีฟังก์ชันธุรกิจที่ใช้สิทธิ์เหล่านี้

PostgreSQL init ทำงานครั้งแรกของ volume เท่านั้น การแก้ชื่อฐานข้อมูลหรือรหัสผ่านใน .env ไม่เปลี่ยนฐานข้อมูลที่มีอยู่โดยอัตโนมัติ ส่วน .env, private keys และข้อมูลจริงไม่เก็บใน Git
