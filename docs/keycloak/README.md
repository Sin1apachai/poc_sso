# ตั้งค่า Keycloak ของ PoC วิธีใหม่

อ่าน [คู่มือฉบับเดียว](SETUP-GUIDE.md) ตามลำดับ: หน้าที่ระบบ → feature → ติดตั้งส่วนขยาย → realm → trust C → clients → headers → ทดสอบ

Compose ใช้ส่วนขยายจริงจาก `keycloak/` แล้ว คำสั่ง `npm run lab:configure` ตั้ง realm/trust/clients โดยไม่สร้าง users/roles ของผู้ใช้ใน Keycloak

- [Flow ทั้ง 10 กรณี](../flows/LOGIN-AND-SESSION.md)
- [API และจำนวน request](../flows/API-CATALOG.md)
- [ผลทดสอบแอปจริง](../flows/TEST-RESULTS.json)

ไม่ต้องสร้าง sync client, service account, user federation link, client role mapping หรือ protocol mappers ตามวิธีเดิม Config IdP ใช้เก็บ trust ของ C เท่านั้น ไม่ได้เรียก native JWT grant เพื่อออก token

## SSO Tokens

Admin Console: sso-lab → SSO Tokens. [คู่มือและภาพหน้าจอ](SETUP-GUIDE.md), [ผลทดสอบ](TOKEN-MENU-TEST-RESULTS.json).
