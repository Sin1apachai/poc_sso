# คู่มือตั้งค่า Keycloak

อ่าน [คู่มือตั้งค่า](SETUP-GUIDE.md) ตามลำดับ: หน้าที่และ feature → เตรียมระบบ → realm → trust C → clients → headers → ตรวจสอบการใช้งาน

คู่มือรวมตำแหน่ง UI และภาพหน้าจอของ SSO Tokens กับ IdP heartbeat ที่ Realm settings → Heartbeat โดย Health Check URL อยู่ใน IdP Settings และหน้า heartbeat เลือก IdP จากรายการ พร้อม Logout targets แบบ Add/Remove ใน Realm settings → Sessions ซึ่งใช้ปุ่ม Save/Revert เดิม และระบุค่าที่ต้องตั้งผ่าน Admin API

- [Clients และ Client scopes ใช้ต่างกัน](SETUP-GUIDE.md#clients-และ-client-scopes-ใช้งานต่างกัน)
- [เชื่อม PostgreSQL และหา token](SETUP-GUIDE.md#เชื่อม-postgresql-และหา-token-ที่-ab-เก็บไว้)
- [ขอบเขต dynamic และจุดที่ยังระบุ A/B](SETUP-GUIDE.md#การเพิ่มแอปและค่าที่อ่านจากการตั้งค่า)

- [กระบวนการทำงาน](../flows/LOGIN-AND-SESSION.md)
- [API และข้อมูลรับส่ง](../flows/API-CATALOG.md)
- [โครงสร้างส่วนขยาย Java](../../keycloak/README.md)
- [ผลทดสอบเมนู SSO Tokens](TOKEN-MENU-TEST-RESULTS.json)
- [ผลทดสอบ IdP heartbeat](IDP-HEARTBEAT-TEST-RESULTS.json)
- [ผลทดสอบ Sessions / Logout targets](SESSION-LOGOUT-TEST-RESULTS.json)
