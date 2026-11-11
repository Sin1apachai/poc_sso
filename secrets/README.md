# กุญแจลงลายเซ็นของ C ในเครื่อง

รัน `npm run keys:generate` จาก root ของ repo ก่อนเปิด C ครั้งแรก เพื่อสร้าง `app-control-jwks.json`

คำสั่งจะไม่เขียนทับกุญแจเดิม หากไฟล์มีอยู่แล้วให้ใช้ไฟล์เดิมและข้ามขั้นตอนนี้ Private keys ถูกละเว้นจาก Git และไม่แนบใน Bruno ZIP ส่วน Keycloak รับเฉพาะ public keys จาก `/oidc/jwks`
