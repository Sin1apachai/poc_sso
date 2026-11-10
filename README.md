# SSO Proof of Concept

ระบบทดลอง SSO ด้วย Node.js, PostgreSQL และ Keycloak 26.8.1 โดยมี C เป็น IdP ตัวเดียว A/B ใช้โค้ดร่วมกัน แต่แยกฐานข้อมูล cookie และ session ตาม environment

| ระบบ           | URL                         | บัญชีเริ่มต้นสำหรับแล็บ               |
| -------------- | --------------------------- | ------------------------------------- |
| A              | http://localhost:4001       | สร้างบัญชี local ด้วย CLI ตามด้านล่าง |
| B              | http://localhost:4002       | สร้างบัญชี local ด้วย CLI ตามด้านล่าง |
| C              | http://localhost:4003       | admin / admin-c                       |
| Keycloak Admin | http://localhost:8080/admin | admin / admin-local-demo              |

บัญชีเหล่านี้เป็นค่าเริ่มต้นของ PoC สำหรับ localhost เท่านั้น

## คู่มือตั้งค่า Keycloak

- [ตั้งค่าทีละขั้นพร้อมภาพ UI และเหตุผล](docs/keycloak/SETUP-GUIDE.md)
- [Feature ที่ใช้และเหตุผลการออกแบบ](docs/keycloak/FEATURES.md)

ภาพใช้ Keycloak 26.8.1 ใน environment ตัวอย่างแยกจาก realm ของคุณ ค่า config อ้างอิงไม่มี secrets และไม่ import อัตโนมัติ

## เอกสาร flow และ API

- [รายการ 10 flows และจำนวน endpoint](docs/flows/README.md)
- [Sequence diagram และ flowchart แยกแต่ละ flow](docs/flows/LOGIN-AND-SESSION.md)
- [รายการ API ของ A/B/C และ Keycloak พร้อมจำนวน request](docs/flows/API-CATALOG.md)

## โครงสร้าง

```text
app/                       # แอปเดียวสำหรับ A/B
  src/auth/                # Login local, cookie, session, CSRF, app JWT
  src/db/                  # PostgreSQL และ schema
  src/sso/                 # ตรวจ token, callback, heartbeat, logout
  src/routes.js            # เส้นทาง HTTP
  src/server.js            # เริ่ม server
  public/                  # JavaScript/CSS ฝั่ง browser
  views/                   # EJS
app-control/               # ระบบ C จัดการผู้ใช้และสิทธิ์
  src/auth/
  src/db/
  src/sso/                 # JWT grant, JWKS, token POST และ revoke
  src/services/            # sync บัญชี/สิทธิ์เข้า Keycloak
  public/
  views/
postgres/init/             # สร้างฐานข้อมูลเมื่อเริ่ม volume ใหม่
scripts/                   # ตรวจ source, generate key และทดสอบ flow ปัจจุบัน
secrets/                   # private key ในเครื่อง ไม่ commit
docs/keycloak/            # เอกสาร flow และ settings อ้างอิง
compose.yaml
.env.example
```

## เริ่มใช้งาน

ต้องมี Docker Compose, Node.js 22 และ Python 3 สำหรับ browser integration tests

```sh
cp .env.example .env
npm ci
npm --prefix app ci
npm --prefix app-control ci
npm run keys:generate
```

แก้ `.env` โดยตั้งรหัสฐานข้อมูล session secrets และ Client Secrets ของ Keycloak ให้ถูกต้อง แล้วรัน:

```sh
docker compose up -d --build
```

Compose สร้าง Keycloak แบบว่าง ไม่ import realm หรือ sync ผู้ใช้ให้อัตโนมัติ ต้องตั้ง realm `sso-lab`, IdP `app-control`, clients `app-a`, `app-b`, `app-control`, `app-control-sync`, roles และ mappers ก่อนใช้ SSO แล้ว sync ผู้ใช้จากหน้า C ค่าตัวอย่างใน `.env.example` ไม่ใช่ Client Secrets ที่ใช้งานได้จริง

ฐานข้อมูลแอปสร้างเฉพาะครั้งแรกที่ PostgreSQL volume ว่าง ส่วน Keycloak ใน Compose นี้ใช้ dev database ใน volume ของตัวเอง

## สร้างผู้ใช้ A/B สำหรับฐานข้อมูลใหม่

C มี admin/admin-c เริ่มต้นอัตโนมัติ ส่วน A/B ไม่มี seed user อัตโนมัติ ฐานข้อมูลแล็บเดิมอาจมีบัญชี admin อยู่แล้ว สำหรับเครื่องใหม่สร้างผ่าน CLI โดยให้อีเมลตรงกับ C หากจะใช้ SSO:

```sh
# ตัวอย่างบัญชีแล็บ ใช้ password คนละค่าต่อแอป
printf '%s' 'admin-a-demo' | docker compose exec -T app-a node src/create-user.js admin@example.com
printf '%s' 'admin-b-demo' | docker compose exec -T app-b node src/create-user.js admin@example.com
```

CLI อ่าน password จาก stdin; ต้องมี 8 ตัวขึ้นไป และไม่เกิน 72 ไบต์

## ขอบเขตโค้ดปัจจุบัน

- A/B 14 routes ต่อระบบ และ C 18 routes รวมทั้งหมด 46 (รวมหน้า HTML, JSON, callback และ SSE)
- Keycloak ที่ backend เรียก 17 method/path templates: protocol/support 5 + Admin API 12
- C ใช้ JWT Authorization Grant และมีเพียง public JWKS ที่ /oidc/jwks ไม่ใช่ OIDC authorization server เต็มรูปแบบ
- ไม่มี consent, /interaction, /logout/backchannel, OIDC code exchange, shared registry หรือ dependency oidc-provider/openid-client
- ไม่มีการสร้าง schema ของ OIDC/registry เก่าบนฐานข้อมูลใหม่ ตารางเก่าที่อยู่ใน volume เดิมไม่ได้ถูก drop เพื่อรักษาข้อมูล
- ไม่แก้ settings Keycloak อัตโนมัติ; realm ต้องตั้งค่าให้ครบก่อน SSO tests

## Login และ Logout

- Login local A/B ตรวจรหัสผ่านในฐานข้อมูลของตัวเอง ไม่ขอ token กลาง
- Login C ตรวจรหัสผ่านใน C แล้วขอ token กลางจาก Keycloak ด้วย JWT Authorization Grant
- A/B SSO ส่ง browser ไป C พร้อม state และ challenge; C ใช้ session ที่มีหรือแสดงหน้า Login
- C ขอ access token สำหรับ client ปลายทาง แล้วส่งผ่าน browser form POST ไป A/B พร้อมผลยืนยันที่ลงลายเซ็น
- A/B ตรวจ token, state, สิทธิ์ `read` และ local account ที่มี email ตรงกัน ก่อนสร้าง app token/session ของตัวเอง
- ไม่มี `/sso/redeem` และไม่มี introspection ตอน Login; ยังมี readiness check และการโหลด JWKS เมื่อ cache ว่าง
- สิทธิ์ `read/write/delete` จัดการที่ C และ sync เป็น client roles ใน Keycloak; ไม่ใช่ทุก role จะมีหน้า CRUD ใน PoC
- Logout A/B ออกเฉพาะแอป; Logout C revoke token กลางและส่ง signed notification ให้ A/B ล้าง SSO sessions ส่วน local sessions คงอยู่
- Heartbeat SSO ทุก 1 ชั่วโมง ไม่มี timer ตรวจ expiry เพิ่ม; คำขอไปยังหน้าที่ป้องกันไว้ตรวจ expiry ด้วย

รายละเอียด: [API flow](docs/keycloak/API-MODE-POC.md), [settings อ้างอิง](docs/keycloak/API-MODE-SETTINGS.json), [heartbeat](docs/keycloak/HOURLY-HEARTBEAT-POC.md)

## ตรวจโค้ดและจัดรูปแบบ

```sh
npm run format
npm run format:check
npm run check
npm test
```

`npm run check` ตรวจ syntax, local imports และ EJS โดยไม่แก้ข้อมูลในฐานข้อมูล ส่วน `npm test` ทดสอบ readiness/retry และการลงลายเซ็น/JWKS แบบไม่เรียก Keycloak จริง

## ทดสอบกับแล็บที่ตั้งค่าครบแล้ว

Browser tests ใช้ `playwright-core`; ตั้ง `CHROME_PATH` หาก Chrome ไม่อยู่ในตำแหน่งมาตรฐานของ macOS

```sh
python3 scripts/test-local-smoke.py
python3 scripts/test-api-mode.py
python3 scripts/test-post-sso.py
python3 scripts/test-explicit-denial.py
python3 scripts/test-hourly-sso.py
```

ทดสอบสร้างบัญชีชั่วคราวแล้วลบเมื่อจบ การทดสอบ hourly เปลี่ยนอายุ token ชั่วคราวแล้วคืนค่า ต้องมี realm/client/service account พร้อมก่อนรัน

## ข้อมูลที่ไม่เผยแพร่

`.env`, private keys, exports ของ realm, screenshots ที่มีข้อมูลจริง, ข้อมูลผู้ใช้, videos, backups ไม่ถูก commit สคริปต์และเอกสาร flow เก่าถูกนำออกจากต้นไม้โปรเจกต์แล้ว เอกสาร settings เป็นค่าอ้างอิง ไม่ใช่ export พร้อมรหัสลับและไม่บอกสถานะ runtime ปัจจุบัน

ภาพ UI ตัวอย่างใน docs/keycloak/images เป็นข้อมูลสมมติจาก Keycloak ชั่วคราวและรวมไว้ใน repository สำหรับคู่มือ โดยปิดบัง secret แล้ว
