# Bruno — API Keycloak ของระบบ SSO

มีเฉพาะ API ฝั่ง Keycloak ที่ใช้ใน runtime ปัจจุบัน 7 เส้น ไม่รวม API ของ A/B/C, Admin CRUD หรือไฟล์ JavaScript ของหน้า UI

## เปิดใช้งาน

1. เปิดแล็บ A/B/C/Keycloak ตามปกติ
2. ใน Bruno เลือก **Open Collection** แล้วเลือกโฟลเดอร์นี้ ซึ่งมี `bruno.json` หากใช้ ZIP ให้แตกไฟล์ก่อนแล้วเลือกโฟลเดอร์ `keycloak`
3. เลือก environment **Local**
4. คลิกไอคอนโล่ของ collection แล้วเลือก **Developer Mode** เพื่อให้ script อ่าน config และลงลายเซ็นด้วย key ของ C
5. ถ้าเปิดจาก `SSO/bruno/keycloak` ใช้ `project_root=../..` ได้เลย หากย้าย/แตก ZIP ไว้ที่อื่น ให้ตั้ง `project_root` เป็น path เต็มของโครงการ เช่น `/Users/hall/Desktop/SSO`
6. ใช้ **Run Collection** เพื่อทดสอบครบ หรือส่งแต่ละ request ตามลำดับด้านล่าง

ไม่ต้องคัดลอก Client Secret ลงไฟล์ collection Script อ่าน `.env` และ `secrets/app-control-jwks.json` จาก project_root ตอนส่งคำขอ ใช้ Node built-ins ไม่ต้องติดตั้ง npm packages ใน collection Private key ใช้ลงลายเซ็นภายในเครื่อง ไม่ได้ส่งเป็น request body หรือแนบใน ZIP

## Request ที่มี

Base URL: `{{keycloak_url}}/realms/{{realm}}`

| ลำดับ | Method / path                         | ใช้ทำอะไร                                                                |
| ----- | ------------------------------------- | ------------------------------------------------------------------------ |
| 01    | GET `/temporary-sso-poc/status`       | ตรวจว่า extension พร้อมตอบ ไม่ได้ยืนยันว่า IdP online                    |
| 02    | GET `/protocol/openid-connect/certs`  | อ่าน public JWKS ของ realm                                               |
| 03    | POST `/temporary-sso-poc/bootstrap`   | จำลอง backend C ขอ token กลางพร้อม signed proof และ C client credentials |
| 04    | POST `/temporary-sso-poc/authorize`   | ขอ HTML ส่ง token ใบเดิมไปแอปที่เลือกพร้อม proof ผูกคำขอ                 |
| 05    | POST `/temporary-sso-poc/introspect`  | ตรวจ active/expiry/cache/สิทธิ์ด้วย credentials ของ A หรือ B             |
| 06    | POST `/temporary-sso-poc/revoke`      | ให้ C ยกเลิก token ที่เลือกทันที                                         |
| 07    | POST `/temporary-sso-poc/logout-user` | ใช้ C signed proof ยกเลิก token ของตัวตนทดสอบ                            |

ทุก POST ใช้ **application/x-www-form-urlencoded** ใน Body ไม่ใช่ JSON และ introspection เป็นเส้น custom ของ extension ไม่ใช่ native `/protocol/openid-connect/token/introspect`

## ตัวแปร

| ตัวแปรใน Local | ค่าเริ่มต้น / การใช้งาน                                    |
| -------------- | ---------------------------------------------------------- |
| keycloak_url   | http://localhost:8080 ไม่ใส่ slash ท้าย                    |
| realm          | sso-lab                                                    |
| project_root   | ../.. หรือ path เต็มของโครงการที่มี .env และ secrets/      |
| control_issuer | http://localhost:4003/oidc ต้องตรงกับ trust C ที่ Keycloak |
| app            | a หรือ b เลือก credentials และ callback ของแอปจาก .env     |

`03 Bootstrap` สร้างตัวตน `bruno-UUID` และ session reference ใหม่สำหรับการจำลอง API โดยมีสิทธิ์ตัวอย่าง A=read/write, B=read ไม่ได้ Login บัญชีจริงที่ C และไม่สร้าง user row ในฐานข้อมูล C/Keycloak ข้อมูลอยู่ใน cache ชั่วคราวของ extension

Token ที่ได้เก็บใน runtime variable `central_access_token` พร้อม jti และตัวตนทดสอบ ใช้ `bru.setVar()` ไม่เขียน token หรือ secrets ลง environment ต้องรัน 03 ใหม่เมื่อเริ่ม run ใหม่หรือ token หมดอายุ

`04 Authorize` ตรวจได้ว่า HTML มี JWT ใบเดิมและ proof ที่มี audience ของแอปที่เลือก Bruno ไม่ส่งฟอร์ม HTML ต่อให้ browser และ collection ไม่ได้สร้าง pending request/cookie ของ A/B จึงไม่ใช่เครื่องมือ Login หน้าแอป การทดสอบ browser Login ต้องเริ่มจากปุ่ม SSO ของแอปตามปกติ

## ลำดับทดสอบ

- ดูการออกและส่ง token เดิม: **03 → 04 → 05**
- ตรวจ revoke: **03 → 06 → 05** ผลท้ายต้อง `active=false`
- ตรวจ logout-user แบบยังมี token: **03 → 07 → 05** ผลท้ายต้อง `active=false`
- ทดสอบแอป B: เปลี่ยน `app=b` แล้วเริ่ม 03 ใหม่

Run Collection 01–07 ทำได้ทั้งหมด แต่ 07 อาจได้ `revoked: 0` เพราะ 06 ยกเลิก token ไปก่อนแล้ว เป็นผลปกติ ไม่ใช่ logout ล้มเหลว

การเรียก `/revoke` หรือ `/logout-user` ตรงใน Keycloak ทำเฉพาะการเพิกถอน token ปุ่ม Logout ของ C จริงยังมีขั้นตอนแจ้ง A/B เพิ่มอีก หากเรียกตรง แอปตรวจพบ inactive ตาม heartbeat หรือเงื่อนไขตรวจของแอป ไม่ได้มี browser logout ทันทีจาก collection นี้

Heartbeat Keycloak → C เป็น background task จึงไม่มี request สำหรับ trigger scheduler ใน collection นี้ และไม่ต้องเพิ่ม Admin API ที่แก้ settings เพื่อทดสอบ token

## Inspect token จริงจากแอป

ใน environment Local เปิด **Secrets** แล้วเพิ่ม `access_token` และวาง token จริง จากนั้นส่ง **05 Introspect** โดยเลือก app ให้ตรง ผู้ใช้ไม่ต้องรัน 03 สำหรับกรณีนี้ ค่า secret เก็บในเครื่องของ Bruno ไม่ใส่ค่าในไฟล์ environment

หากส่ง **06 Revoke** ขณะมี secret `access_token` จะยกเลิก token จริงนั้น ส่วน 04/07 ใช้เฉพาะตัวตนจำลองจาก 03 ให้ล้าง secret access_token ก่อนทดสอบลำดับจำลอง

## รันผ่าน CLI

ทดสอบกับ Bruno CLI **4.3.0** จากโฟลเดอร์ collection:

```sh
bru run --env Local --sandbox=developer --bail
bru run --env Local --sandbox=developer --env-var app=b --bail
bru run "03 Bootstrap.bru" "06 Revoke.bru" "05 Introspect.bru" --env Local --sandbox=developer --bail
bru run "03 Bootstrap.bru" "07 Logout User.bru" "05 Introspect.bru" --env Local --sandbox=developer --bail
```

ถ้าได้ 401 ให้ตรวจ Client Secret ใน .env เทียบกับ Credentials ของ client ใน Keycloak ถ้าได้ 400 ให้ตรวจ trust C/กุญแจ และ issuer/callback ส่วน 503 อาจเป็น IdP ถูก heartbeat ระบุว่า down ต้องให้ C กลับมาและรอรอบตรวจผ่านก่อน อย่าใช้ proof เก่าคัดลอกมายิงซ้ำ เพราะหมดอายุใน 60 วินาทีและใช้ได้ครั้งเดียว Script สร้าง proof ใหม่ให้ทุก Send อยู่แล้ว

ดู [ผลทดสอบ collection](TEST-RESULTS.json), [Bruno Developer Mode](https://docs.usebruno.com/get-started/configure/javascript-sandbox), [Runtime variables](https://docs.usebruno.com/testing/script/javascript-reference#brusetvarkey-value) และ [Secret variables](https://docs.usebruno.com/secrets-management/secret-variables)
