# Sequence diagram และ flowchart แยกตาม flow

[รายการ flow](README.md) · [API และวิธีนับ](API-CATALOG.md)

ทุก sequence แยก Browser ออกจาก backend; คำตอบ Redirect ไม่ใช่ server เรียก server ส่วนลูกศร backend ที่ระบุ POST/GET คือ HTTP จริง การตรวจ signature/permission ภายในแอปไม่ใช่ request ออกไปภายนอก

จำนวนด้านล่างไม่รวมไฟล์ static, Docker healthchecks, SSE ที่เปิดค้าง และการ refresh JWKS เว้นแต่ระบุไว้

## F01 — Login local ของ A/B

ตรวจบัญชีใน DB ของแอปเอง ไม่ต้องมีผู้ใช้ C และไม่สร้าง token กลาง

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant D as ฐานข้อมูลแอป
    U->>A: GET /login/local
    A-->>U: Redirect /login
    U->>A: GET /login
    A-->>U: หน้า Login พร้อม CSRF
    U->>A: POST /login (บัญชี รหัสผ่าน CSRF)
    A->>D: อ่านบัญชีและตรวจ password hash
    A->>D: สร้าง app token และ session ของแอป
    A-->>U: Set-Cookie และ Redirect /
    U->>A: GET /
    A-->>U: Dashboard แบบ local
```

[เปิดภาพ PNG: F01 sequence](images/f01-sequence.png)

```mermaid
flowchart TD
    S[เปิด Login local] --> F[กรอกบัญชีและรหัสผ่าน]
    F --> V{CSRF และรหัสผ่านถูกต้อง?}
    V -->|ไม่| E[แสดงข้อผิดพลาด]
    V -->|ใช่| T[สร้าง app token และ session ของแอป]
    T --> H[แสดง Dashboard]
```

[เปิดภาพ PNG: F01 flowchart](images/f01-flowchart.png)

เส้นหลักที่ผู้ใช้ส่งข้อมูลคือ POST /login **1 ครั้ง**; เส้นทางตัวอย่างเต็มมี browser requests **4 ครั้ง** รวมหน้าเว็บและ redirects Keycloak **0 ครั้ง**

## F02 — Login C โดยตรงและขอ token ของ C

Login C สำเร็จก่อนเชื่อม SSO หาก Keycloak ล่ม C ยังมี local session หน้า dashboard ตรวจสถานะแบบ polling และ POST continue เมื่อพร้อม

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant C as ระบบ C
    participant K as Keycloak
    U->>C: GET /login
    C-->>U: หน้า Login พร้อม CSRF
    U->>C: POST /login
    C->>C: ตรวจรหัสผ่าน สร้าง C app token/session
    C-->>U: Redirect /
    C->>K: GET discovery (ตรวจพร้อม สูงสุด 3 ครั้ง)
    K-->>C: metadata และ issuer
    U->>C: GET /
    loop อ่านสถานะตามหน้า dashboard
        U->>C: GET /sso/status
        C-->>U: ready หรือสถานะอื่น
    end
    U->>C: POST /sso/continue พร้อม CSRF
    C->>K: POST token (JWT bearer, client app-control)
    K-->>C: central access token ของ C
    C->>C: ตรวจ JWT บันทึก token และสถานะ success
    C-->>U: Redirect /
    U->>C: GET /
    C-->>U: Dashboard SSO พร้อมใช้งาน
```

[เปิดภาพ PNG: F02 sequence](images/f02-sequence.png)

```mermaid
flowchart TD
    L[Login C] --> P{รหัสผ่านถูกต้อง?}
    P -->|ไม่| E[แสดง Login error]
    P -->|ใช่| C[สร้าง local session ของ C]
    C --> D{Discovery พร้อม?}
    D -->|ไม่| R[retry การตรวจพร้อม สูงสุด 3 ครั้ง]
    R -->|ครบแล้วยังไม่ผ่าน| X[แจ้งสร้าง SSO ไม่ได้ แต่ C local ยังใช้ได้]
    R -->|ผ่านระหว่าง retry| A
    D -->|ใช่| A[Browser POST continue]
    A --> T{ขอ central token สำเร็จ?}
    T -->|ไม่| X
    T -->|ใช่| H[บันทึก token และแสดง SSO พร้อมใช้งาน]
```

[เปิดภาพ PNG: F02 flowchart](images/f02-flowchart.png)

Keycloak กรณีสำเร็จปกติ: discovery **1** + token **1** = **2 requests** บวก certs เมื่อ cache ต้องโหลด จำนวน status polling ไม่คงที่ GET /sso/status ไม่ได้เรียก Keycloak ทุกครั้ง

## F03 — กด SSO A/B และยังไม่มี session C

ภาพเริ่มเมื่อมีหน้า Login A/B แล้ว ผู้ใช้กดปุ่มเอง; automatic silent check ที่อาจเกิดตอนเปิด /login ครั้งแรกแยกอยู่ F04

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant K as Keycloak
    participant C as ระบบ C
    U->>A: POST /sso/preflight พร้อม CSRF
    A->>K: GET discovery
    K-->>A: พร้อมใช้งาน
    A-->>U: JSON authorizationUrl ของ C
    U->>C: GET /sso/authorize (state, challenge, client_id)
    C-->>U: Redirect /login?request=...
    U->>C: GET /login?request=...
    C-->>U: หน้า Login C
    U->>C: POST /login (รหัสผ่านและ pending request)
    C->>C: ตรวจบัญชี สร้าง C session ย้าย pending request
    C-->>U: Redirect /sso/resume?request=...
    U->>C: GET /sso/resume?request=...
    C->>K: POST token (JWT bearer สำหรับ A หรือ B)
    K-->>C: central token พร้อมสิทธิ์ปลายทาง
    C-->>U: HTML form POST อัตโนมัติ
    U->>A: POST /sso/callback (token, state, signed response)
    A->>A: ตรวจ binding, JWT, read, local account และ Logout cutoff
    A->>A: สร้าง app token/session ของตัวเอง
    A-->>U: Redirect /
    U->>A: GET /
    A-->>U: Dashboard แบบ SSO
```

[เปิดภาพ PNG: F03 sequence](images/f03-sequence.png)

```mermaid
flowchart TD
    S[กด Login ด้วย C] --> P{Keycloak พร้อม?}
    P -->|ไม่| E[อยู่หน้า Login และแสดง connection modal]
    P -->|ใช่| C[เปิด C authorize]
    C --> L[Login ที่ C และสร้าง C session]
    L --> R[กลับ C resume]
    R --> K[ขอ token สำหรับแอปปลายทาง]
    K --> B[Browser POST token กลับ A/B]
    B --> V{binding, JWT, สิทธิ์, local account ผ่าน?}
    V -->|ไม่| D[ปฏิเสธหรือกลับ Login ตามเหตุผล]
    V -->|ใช่| A[สร้าง session ของ A/B และเข้า Dashboard]
```

[เปิดภาพ PNG: F03 flowchart](images/f03-flowchart.png)

Token issuance มี **C→Keycloak 1 request**; preflight discovery อีก **1 request** ฝั่ง browser ตามภาพมี **7 requests** ไม่รวม progress polling `/sso/connectivity` และ assets ไม่มี `/sso/redeem` และไม่มี Login introspection

การ Login C ผ่าน relay นี้ไป `/sso/resume` โดยตรง **ไม่ได้ bootstrap token app-control เพิ่ม** เหมือน F02

## F04 — มี session C แล้ว เข้า A/B โดยไม่กรอกรหัสผ่านซ้ำ

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant K as Keycloak
    participant C as ระบบ C
    U->>A: GET /sso หรือ POST /sso/preflight
    A->>K: GET discovery
    K-->>A: พร้อม
    A-->>U: Redirect หรือ JSON URL ของ C
    U->>C: GET /sso/authorize พร้อม cookie C
    C->>C: ตรวจ C session และสิทธิ์ที่ sync แล้ว
    C->>K: POST token สำหรับ client ปลายทาง
    K-->>C: central token
    C-->>U: HTML form POST อัตโนมัติ
    U->>A: POST /sso/callback
    A->>A: ตรวจ token/สิทธิ์/local account แล้วสร้าง app session
    A-->>U: Redirect /
    U->>A: GET /
    A-->>U: Dashboard
```

[เปิดภาพ PNG: F04 sequence](images/f04-sequence.png)

```mermaid
flowchart TD
    S[เข้า SSO A/B] --> P[ตรวจ Keycloak พร้อม]
    P --> C{C session ยังใช้ได้?}
    C -->|ใช่| T[ออก token สำหรับ A/B]
    T --> V[POST กลับและตรวจใน A/B]
    V --> H[สร้าง session A/B]
    C -->|ไม่ และ explicit| L[ไป Login C ตาม F03]
    C -->|ไม่ และ silent| B[กลับ Login A/B โดยไม่แสดง modal ไม่มีสิทธิ์]
```

[เปิดภาพ PNG: F04 flowchart](images/f04-flowchart.png)

เส้นทางพื้นฐาน **browser 4 requests** + **Keycloak 2 requests** (discovery 1 + token 1) บวกกุญแจเมื่อจำเป็น

- กดลิงก์ใน C เพิ่ม browser GET `/connect/:system` **1** ก่อนมาถึง `/sso` และ UI เช็ค `/sso/status` ก่อนเดินทาง
- เปิด `/login` A/B ครั้งแรกอาจเริ่ม silent SSO ใน request นั้นเลย; mode silent ไม่บังคับไป Login C ถ้าไม่มี C session
- กดปุ่มบน A/B มี progress polling เพิ่ม ไม่ใช่ request ไป Keycloak
- token ของ A กับ B คนละใบ ส่วนการไม่ถามรหัสผ่านซ้ำอาศัย C session

## F05 — ไม่มีสิทธิ์หรือไม่มีผู้ใช้ใน A/B

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant K as Keycloak
    participant C as ระบบ C
    U->>C: GET /sso/authorize จากคำขอ A/B
    alt C ไม่ให้ read หรือข้อมูลยังไม่ synced
        C-->>U: Redirect callback พร้อม access_denied และ state
        U->>A: GET /sso/callback?error=access_denied
    else C ให้สิทธิ์
        C->>K: POST token
        K-->>C: central token
        C-->>U: ฟอร์ม POST
        U->>A: POST /sso/callback
        A->>A: พบไม่มี read ใน JWT หรือไม่มี local email ตรงกัน
    end
    A-->>U: Redirect /login
    U->>A: GET /login
    A-->>U: explicit แสดง modal ครั้งเดียว ส่วน silent ไม่แสดง modal
```

[เปิดภาพ PNG: F05 sequence](images/f05-sequence.png)

```mermaid
flowchart TD
    C{C ให้ read และ sync แล้ว?} -->|ไม่| D[access_denied ก่อนขอ token]
    C -->|ใช่| T[ขอ token จาก Keycloak]
    T --> P{JWT มี read?}
    P -->|ไม่| D
    P -->|ใช่| U{มี local account email ตรง?}
    U -->|ไม่| M[missing-user]
    U -->|ใช่| H[เข้าสู่ระบบ]
    D --> E{ผู้ใช้กด SSO เอง?}
    M --> E
    E -->|ใช่| N[Login และ modal ครั้งเดียว]
    E -->|ไม่| L[Login ไม่มี modal]
```

[เปิดภาพ PNG: F05 flowchart](images/f05-flowchart.png)

หลังผ่าน preflight แล้ว: C ปฏิเสธก่อน token → token **0**; A/B ปฏิเสธหลัง token → token **1** ไม่มี API ไปหาแอปอื่นเพื่อสร้าง local account ให้อัตโนมัติ

ลายเซ็น/state/token ปลอมแปลงเป็น **HTTP 400** ไม่ใช่ modal ไม่มีสิทธิ์ทุกกรณี

## F06 — Keycloak ติดต่อไม่ได้หรือออก token ไม่ได้

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant K as Keycloak
    participant C as ระบบ C
    alt explicit preflight ของ A/B ล้มเหลว
        U->>A: POST /sso/preflight
        loop สูงสุด 3 ครั้ง เฉพาะความผิดพลาดที่ retry ได้
            A->>K: GET discovery
            K--xA: ติดต่อไม่ได้ หรือ 5xx
        end
        A-->>U: HTTP 503 JSON
        U->>U: แสดง modal อยู่หน้า Login เดิม
    else discovery ผ่าน แต่ขอ token ที่ C ไม่สำเร็จ
        U->>C: GET /sso/authorize หรือ /sso/resume
        C->>K: POST token 1 ครั้ง
        K--xC: ล้มเหลว
        C-->>U: Redirect callback error temporarily_unavailable
        U->>A: GET /sso/callback
        A-->>U: Redirect /login พร้อมแจ้ง connection error
    end
```

[เปิดภาพ PNG: F06 sequence](images/f06-sequence.png)

```mermaid
flowchart TD
    S[เริ่ม SSO] --> D{Discovery ผ่าน?}
    D -->|ไม่| R[retry เฉพาะการตรวจพร้อม]
    R -->|ครบแล้วยังไม่ผ่าน| E[แจ้ง connection error]
    R -->|ผ่านระหว่าง retry| C
    D -->|ใช่| C[เข้า C เพื่อขอ token]
    C --> T{POST token สำเร็จ?}
    T -->|ไม่| E
    T -->|ใช่| H[ดำเนิน Login ต่อ]
    E --> L[ไม่ส่ง browser ไปหน้า Keycloak]
```

[เปิดภาพ PNG: F06 flowchart](images/f06-flowchart.png)

- explicit A/B และ direct bootstrap C: discovery สูงสุด **3** ครั้ง เว้นช่วง 2 และ 5 วินาที
- automatic silent A/B: discovery **1** ครั้ง
- issuer ผิดหรือ HTTP 4xx ที่ไม่ใช่ 429: หยุดทันที ไม่ retry จนครบ 3
- **POST token ไม่ได้ retry 3 ครั้งในโค้ดปัจจุบัน** หากล้มเหลวให้เริ่มใหม่จาก UI
- หากเป็น direct Login C: C session คงอยู่ สถานะ SSO failed และแสดง modal ใน C

## F07 — Heartbeat, token หมดอายุ หรือถูก revoke

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant K as Keycloak
    U->>A: GET /session/heartbeat ทุก 1 ชั่วโมง
    A->>A: ตรวจ exp และลายเซ็น central/app token
    alt token หมดอายุหรือไม่ถูกต้อง
        A->>A: ล้าง session ที่ยืนยันตัวตน
        A-->>U: HTTP 401 พร้อม loginUrl
        U->>A: GET /login
    else token ยังไม่หมดอายุ
        A->>K: POST token/introspect
        alt active
            K-->>A: active true
            A-->>U: HTTP 200 authenticated true
        else revoked
            K-->>A: active false
            A->>A: ล้าง SSO session
            A-->>U: HTTP 401
            U->>A: GET /login
        else เชื่อมต่อไม่ได้
            K--xA: timeout หรือ error
            A-->>U: HTTP 503
            U->>U: รอรอบตรวจถัดไป ไม่สรุปว่าถูก revoke
        end
    end
```

[เปิดภาพ PNG: F07 sequence](images/f07-sequence.png)

```mermaid
flowchart TD
    H[ครบ 1 ชั่วโมง] --> V{JWT และ exp ผ่าน?}
    V -->|ไม่| L[ล้าง session และกลับ Login]
    V -->|ใช่| I[Introspect กับ Keycloak]
    I --> R{ผลตรวจ}
    R -->|active| S[ใช้งานต่อ]
    R -->|inactive| L
    R -->|ติดต่อไม่ได้| W[503 รอรอบถัดไป]
```

[เปิดภาพ PNG: F07 flowchart](images/f07-flowchart.png)

Browser heartbeat **1 request ต่อรอบ**; Keycloak introspection **0 หรือ 1** ตามว่า exp ผ่านหรือไม่ ไม่มี timer/focus check เพิ่ม Protected requests ก็ตรวจ exp และ introspect เมื่อเลยช่วงตรวจ 1 ชั่วโมง ส่วน local Login ไม่มี browser heartbeat script นี้

## F08 — Logout A/B เฉพาะแอป

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant A as ระบบ A หรือ B
    U->>A: POST /logout พร้อม CSRF
    A->>A: ลบ session และ clear cookie ของแอปนี้
    A-->>U: Redirect /login/local
    U->>A: GET /login/local
    A-->>U: Redirect /login
    U->>A: GET /login
    A-->>U: หน้า Login ไม่เริ่ม silent SSO ซ้ำ
```

[เปิดภาพ PNG: F08 sequence](images/f08-sequence.png)

```mermaid
flowchart TD
    L[กด Logout A/B] --> C{CSRF ผ่าน?}
    C -->|ไม่| E[403]
    C -->|ใช่| D[ล้าง session และ cookie ของแอปนี้]
    D --> H[กลับหน้า Login local]
```

[เปิดภาพ PNG: F08 flowchart](images/f08-flowchart.png)

Browser **3 requests** ตามภาพ; Keycloak **0** C และแอปอื่นไม่ Logout ตามการกดนี้

## F09 — Logout C, revoke token กลาง และบังคับ A/B Logout

```mermaid
sequenceDiagram
    autonumber
    actor U as Browser หน้า C
    participant C as ระบบ C
    participant K as Keycloak
    participant A as ระบบ A/B
    actor B as Browser หน้า A/B
    U->>C: POST /logout พร้อม CSRF
    C->>C: ทำเครื่องหมายปิด C session และ lock ผู้ใช้
    loop token ที่ยังไม่หมดอายุและยังไม่ revoked จำนวน N ใบ
        C->>K: POST revoke ของ token นั้น
        K-->>C: สำเร็จ
    end
    loop แต่ละ client/sub ที่เคยออก token ให้
        C->>A: POST /logout/control พร้อม C signed logout
        A->>A: ตรวจลายเซ็น บันทึก cutoff และล้าง SSO sessions
        A-->>B: logout event ผ่าน SSE ที่เปิดค้าง
        B->>A: GET /login/local แล้ว /login
        A-->>C: HTTP 200
    end
    C->>C: ล้าง C session และ cookie หลังขั้นตอนสำเร็จ
    C-->>U: Redirect /login
    U->>C: GET /login
```

[เปิดภาพ PNG: F09 sequence](images/f09-sequence.png)

```mermaid
flowchart TD
    L[Logout C] --> F[ปิดแหล่งออก token และ lock ผู้ใช้]
    F --> R[revoke central tokens ที่ยังใช้ได้]
    R --> N[ส่ง signed Logout ไป A/B]
    N --> O{ทุกขั้นตอนสำเร็จ?}
    O -->|ใช่| C[ล้าง C session และกลับ Login]
    O -->|ไม่| E[503 แจ้ง Logout ไม่สำเร็จและคง C session เพื่อ retry]
```

[เปิดภาพ PNG: F09 flowchart](images/f09-flowchart.png)

Keycloak revoke **N requests** ตาม token ที่ยังไม่หมดอายุ ไม่เรียก Admin logout หรือขอ service-account token ใน Logout flow แล้ว C→A/B notification **0–2** ตาม client/sub ที่บันทึกไว้ปกติ ถ้ามีหลาย central sub จำนวน notification อาจมากขึ้น

SSE event เป็นข้อมูลใน connection เดิม ไม่ใช่ HTTP request ใหม่ การตรวจ cutoff ทำให้ form token ที่ส่งช้าหลัง Logout ไม่สามารถเปิด session กลับมาได้ Local A/B sessions ไม่ถูกล้าง

การ rollback DB ไม่ย้อนคืน network revoke ที่สำเร็จไปแล้ว การ retry จึงอาจพบ token บางใบถูก revoke ไปก่อนแล้ว

## F10 — จัดการผู้ใช้และสิทธิ์ใน C

```mermaid
sequenceDiagram
    autonumber
    actor U as ผู้ดูแล / Browser
    participant C as ระบบ C
    participant K as Keycloak
    participant A as ระบบ A/B
    U->>C: POST /users หรือ /users/{id} หรือ /users/{id}/sync
    C->>C: ตรวจ admin/CSRF บันทึกข้อมูลและ audit
    opt service-account token ไม่มีหรือหมดอายุ
        C->>K: POST token (client_credentials)
        K-->>C: Admin API Bearer token
    end
    C->>K: GET users ด้วย email
    opt ยังไม่มีบัญชี
        C->>K: POST users แล้ว GET users อีกครั้ง
    end
    C->>K: PUT user (email, enabled)
    C->>K: GET federated-identity
    opt ยังไม่มี link C
        C->>K: POST federated-identity/app-control
    end
    loop app-a และ app-b
        C->>K: GET clients, role definitions และ role mappings
        C->>K: POST/DELETE role mappings เฉพาะรายการที่เปลี่ยน
        C->>K: GET effective composite roles
    end
    opt ปิดบัญชีหรือลบผู้ใช้
        C->>K: revoke tokens ที่ยังไม่หมดอายุ
        C->>A: POST /logout/control เพื่อล้าง SSO sessions
    end
    C->>C: บันทึก synced หรือ error
    C-->>U: Redirect /users?saved=1
```

[เปิดภาพ PNG: F10 sequence](images/f10-sequence.png)

```mermaid
flowchart TD
    A[ผู้ดูแลบันทึก user/permissions] --> V{admin และข้อมูลถูกต้อง?}
    V -->|ไม่| E[ปฏิเสธ]
    V -->|ใช่| D[บันทึกฐานข้อมูล C]
    D --> T[ขอ service-account token ถ้าจำเป็น]
    T --> U[สร้างหรือปรับ Keycloak user และ link C]
    U --> R[เทียบ read/write/delete ของ A และ B]
    R --> M[เพิ่มหรือถอนเฉพาะ role ที่เปลี่ยน]
    M --> P{ปิดหรือลบบัญชี?}
    P -->|ใช่| X[revoke และแจ้ง Logout]
    P -->|ไม่| S[บันทึก sync success]
    X --> S
    U -->|API error| F[บันทึก sync error และรอ retry]
    M -->|API error| F
```

[เปิดภาพ PNG: F10 flowchart](images/f10-flowchart.png)

Sync enabled user ที่มีบัญชี/link/roles ตรงอยู่แล้วใช้ Admin API **11 requests** ไม่รวม service-account token ที่ cache ไว้ได้ หากสร้างบัญชีใหม่เพิ่ม POST user + GET lookup อีกครั้ง และเพิ่ม POST link เมื่อยังไม่มี การเปลี่ยนแต่ละ role เพิ่ม POST หรือ DELETE ต่อ role จริง

POST /users/{id}/delete มีขั้นตอนเพิ่ม: ปิดบัญชีและถอนสิทธิ์ให้ sync สำเร็จ → revoke/Logout → DELETE federated link → ลบผู้ใช้เฉพาะ DB ของ C ไม่ได้ DELETE Keycloak user
