# Login และ Session ของ PoC จริง

ยึดโค้ด `app/`, `app-control/` และ `keycloak/` ใน Compose ทุก flow มี sequence diagram และ flowchart อ่าน [ภาพรวม](README.md) และ [API catalog](API-CATALOG.md) ประกอบ

ภาพเป็น Mermaid ฉบับใหม่ ไม่อ้าง PNG เดิมที่เป็นวิธี sync ผู้ใช้ C server เก็บ token กลางที่ได้จาก bootstrap และ Keycloak ไม่มี user row ของผู้ใช้ ตัวตนใน token อ้าง stable sub ที่คำนวณจาก issuer/subject C

## F01 — Login local A/B

ผู้ใช้เลือกช่องทางปกติ ตรวจบัญชีในฐานข้อมูลแอปนั้น ไม่สร้าง token กลาง

```mermaid
sequenceDiagram
    autonumber
actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant D as ฐานข้อมูลของแอป
    U->>A: POST /login พร้อม CSRF
    A->>D: ตรวจบัญชีและ password hash
    D-->>A: ผลตรวจ
    alt ถูกต้อง
        A->>A: เปลี่ยน session ID และสร้าง app token/session
        A-->>U: Redirect /
        U->>A: GET /
        A-->>U: แสดง LOCAL LOGIN
    else ไม่ถูกต้อง
        A-->>U: หน้า Login พร้อม error
    end
```

[เปิดภาพ PNG: F01 sequence](images/f01-sequence.png)

```mermaid
flowchart TD
S[Login local] --> V{บัญชีและรหัสผ่านถูกต้อง?}
    V -->|ใช่| T[สร้าง app token/session ของแอปนี้]
    T --> H[เข้าใช้งานแบบ local]
    V -->|ไม่| E[แสดงข้อผิดพลาด]
```

[เปิดภาพ PNG: F01 flowchart](images/f01-flowchart.png)

Keycloak **0 requests ในการตรวจ local Login** หน้า Login ครั้งแรกอาจตรวจ silent SSO ก่อนแสดงฟอร์ม แต่ไม่ได้เปลี่ยนให้ local Login ใช้ token กลาง Login local A ไม่ทำให้ Login B หรือ C อัตโนมัติ

## F02 — Login C โดยตรง

ยืนยันรหัสผ่าน C สำเร็จแล้วเริ่มขอ token กลางทันที ไม่รอเข้า A/B สถานะ success ต้องได้รับและตรวจ JWT แล้ว ไม่ใช่ผล healthcheck

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Browser
    participant C as ระบบ C
    participant K as Keycloak + ส่วนขยาย
    U->>C: POST /login พร้อม CSRF
    C->>C: ตรวจบัญชีและสร้าง app token/session C
    C->>C: เริ่มงานขอ token กลางทันที
    C-->>U: Redirect dashboard C แสดงกำลังขอ token
    loop สูงสุด 3 ครั้งเมื่อออก token ไม่สำเร็จแบบชั่วคราว
        C->>K: POST /bootstrap พร้อม signed proof ใหม่และ C client auth
        K->>K: ตรวจหลักฐานและออก token กลาง aud sso-apps
        K-->>C: Token กลางของ C
    end
    C->>C: ตรวจ signature issuer aud exp sub และ generation
    C->>C: เก็บ C token ฝั่ง server แล้วตั้ง success
    U->>C: GET /sso/status
    C-->>U: tokenIssued true และเวลาหมดอายุ ไม่มี JWT ใน response
    Note over C,K: มีแถว app-control ใน SSO Tokens ก่อนเปิด A/B
```

[เปิดภาพ PNG: F02 sequence](images/f02-sequence.png)

```mermaid
flowchart TD
    L[Login C] --> V{บัญชีและรหัสผ่านถูกต้อง?}
    V -->|ไม่| E[ไม่สร้าง session]
    V -->|ใช่| S[สร้าง app token และ session C]
    S --> B[ขอ token กลางทันทีด้วย POST bootstrap]
    B --> T{ได้รับและตรวจ JWT ผ่าน?}
    T -->|ผ่าน| R[เก็บ C token และแสดงสำเร็จ]
    T -->|error ชั่วคราว| Y[retry สูงสุด 3 ครั้ง proof ใหม่ทุกครั้ง]
    Y --> B
    Y -->|ครบแล้วยังไม่ผ่าน| F[failed และ modal แต่ local C ยังใช้ได้]
    R --> A[เลือก A/B แล้วต่อ F04]
```

[เปิดภาพ PNG: F02 flowchart](images/f02-flowchart.png)

ปกติ C→Keycloak bootstrap **1 request**; หากติดต่อไม่ได้สูงสุด 3 พร้อมรอ 2 และ 5 วินาที ไม่ retry client/proof configuration errors แบบเดิมซ้ำ ทุกครั้งใช้ jti ของ proof ใหม่

Token กลางมี aud sso-apps และ app_permissions รวมสิทธิ์ของผู้ใช้ เมื่อเข้า A/B จะรับ JWT ใบเดิมทุกตัวอักษร โดย Keycloak ส่งตรงผ่าน browser POST พร้อมหลักฐาน handoff อายุไม่เกิน 60 วินาทีซึ่งผูก state/challenge และ hash ของ token ไม่ได้ออก access token ใหม่

## F03 — กด SSO A/B เมื่อยังไม่มี session C

Login C ครั้งเดียวได้ token กลางหนึ่งใบ จากนั้น Keycloak ส่งใบเดิมกลับ A/B ผ่าน browser POST พร้อมหลักฐาน handoff แยกจาก access token

```mermaid
sequenceDiagram
    autonumber
actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant C as ระบบ C
    participant K as Keycloak + ส่วนขยาย
    U->>A: POST /sso/preflight พร้อม CSRF
    A->>K: GET /temporary-sso-poc/status
    K-->>A: พร้อม
    A->>A: เก็บ state/verifier ของ browser
    A-->>U: URL เริ่ม Login C
    U->>C: GET /sso/authorize พร้อม state/challenge/client
    C-->>U: หน้า Login C
    U->>C: POST /login
    C->>C: ตรวจบัญชีและสร้าง token/session C
    C->>C: ใช้คำขอ SSO ครั้งเดียวที่ผูกกับ session ก่อน Login
    C->>K: POST /bootstrap เพื่อขอ token กลาง C
    K-->>C: Token aud sso-apps
    C->>C: ตรวจและเก็บ C token ก่อนดำเนินต่อ
    C->>C: ลงลายเซ็น proof ด้วยสิทธิ์ที่อ่านล่าสุดในคำขอ Login เดิม
    C-->>U: หน้าส่งต่อ proof ในเฟรม
    U->>K: POST /temporary-sso-poc/authorize
    K->>K: ตรวจ proof callback สิทธิ์ และ replay
    K->>K: อ่าน token กลางเดิมจาก cache และเซ็นหลักฐาน handoff
    K-->>U: ฟอร์ม token ใบเดิมและ handoff ไป A/B ภายในเฟรม
    U->>A: POST /sso/callback พร้อม token เดิม/state/handoff
    A->>A: ตรวจ JWT binding สิทธิ์ และบัญชี local
    A->>A: สร้าง app token/session
    A-->>U: หน้าสำเร็จในเฟรม ส่งสัญญาณสำเร็จที่ไม่มี token
    U->>A: GET / ในหน้าหลัก
    A-->>U: แสดง CENTRAL SSO
```

[เปิดภาพ PNG: F03 sequence](images/f03-sequence.png)

```mermaid
flowchart TD
S[กด SSO A/B] --> P{Keycloak พร้อม?}
    P -->|ไม่| E[Login และ modal ตาม F06]
    P -->|พร้อม| C[Login C สร้าง sessionและขอ token กลาง C]
    C --> F[C ลงลายเซ็น proof]
    F --> K[Browser POST proof ให้ Keycloak ในเฟรม]
    K --> V{หลักฐานและสิทธิ์ผ่าน?}
    V -->|ไม่| D[ปฏิเสธหรือกลับ Login ตามเหตุผล]
    V -->|ผ่าน| T[ส่ง token กลางใบเดิมและ handoff ตรง A/B ในเฟรม]
    T --> A{JWT binding สิทธิ์และบัญชีแอปผ่าน?}
    A -->|ไม่| D
    A -->|ผ่าน| H[สร้าง session แล้วเปิดหน้าหลัก A/B]
```

[เปิดภาพ PNG: F03 flowchart](images/f03-flowchart.png)

A/B ตรวจ RS256, issuer, audience, exp, required claims, `idp`, `temporary_identity`, state/challenge, read และ email ที่ตรงบัญชี local

Login C ใน flow นี้เพิ่ม backend bootstrap C 1 request ปกติ และตรวจ C JWT ด้วย Keycloak JWKS เมื่อ cache ว่าง จากนั้นส่ง token ใบเดิมไป A/B ตามภาพ

Browser มี **6 คำขอหลัก** ตาม [API catalog](API-CATALOG.md) และโหลด script ส่งต่อ 3 เส้นแยกต่างหาก A/B backend ตรวจพร้อม 1 ครั้งเมื่อปกติ ส่วน Keycloak โหลด C JWKS เพื่อยืนยัน proof และ A/B โหลด Keycloak JWKS เมื่อ cache ว่าง ไม่มี code exchange, redeem หรือ introspection ตอน Login

สัญญาณจาก callback ให้หน้าส่งต่อ C มีเพียง `sso-complete` ไม่มี token C script ตรวจทั้ง origin และหน้าต่างต้นทางก่อนเปิดหน้าหลัก A/B เฟรมนี้ทำให้ timeout กลับ Login ได้เมื่อ Keycloak ล่ม

## F04 — มี session C แล้วเข้าอีกแอป

ใช้ session C และ token กลางใบเดิม ไม่ถามรหัสผ่านซ้ำ สร้างเพียง proof/handoff ใหม่ผูกกับคำขอ Login ไม่สร้าง access token เพิ่ม

```mermaid
sequenceDiagram
    autonumber
actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant C as ระบบ C
    participant K as Keycloak + ส่วนขยาย
    opt เริ่มจากลิงก์ dashboard C
        U->>C: GET /connect/app-a หรือ app-b
        C-->>U: Redirect ไป /sso ของแอป
    end
    U->>A: GET /sso หรือ POST /sso/preflight
    A->>K: GET /temporary-sso-poc/status
    K-->>A: พร้อม
    A-->>U: ไป C พร้อม state/challenge ใหม่
    U->>C: GET /sso/authorize พร้อม cookie C
    C->>C: ตรวจ session และ token กลาง C
    opt ต้องขอ C token ใหม่
        C->>K: POST /bootstrap
        K-->>C: Token aud sso-apps
        C->>C: ตรวจและเก็บ C token
    end
    C->>C: อ่านสิทธิ์ล่าสุดและลงลายเซ็น proof สำหรับ A/B
    C-->>U: ฟอร์ม proof ในเฟรม
    U->>K: POST /temporary-sso-poc/authorize
    K-->>U: ฟอร์ม token เดิมและ handoff ตรงไป A/B
    U->>A: POST /sso/callback
    A->>A: ตรวจและสร้าง session ของแอป
    A-->>U: หน้าสำเร็จและสัญญาณที่ไม่มี token
    U->>A: GET / ในหน้าหลัก
```

[เปิดภาพ PNG: F04 sequence](images/f04-sequence.png)

```mermaid
flowchart TD
S[เริ่ม SSO แอปปลายทาง] --> P[ตรวจพร้อมและสร้าง state/challenge]
    P --> C{session C ใช้ได้?}
    C -->|มี| F[ลงลายเซ็น proof ไม่ถามรหัสผ่าน]
    C -->|ไม่มี แบบกดเอง| L[ไป Login C ตาม F03]
    C -->|ไม่มี แบบ silent| B[กลับ Login A/B ไม่แสดง modal ไม่มีสิทธิ์]
    F --> K[Keycloak ส่ง token ใบเดิมและหลักฐาน handoff]
    K --> A[A/B รับและตรวจ token]
    A --> H[สร้าง session แอปปลายทาง]
```

[เปิดภาพ PNG: F04 flowchart](images/f04-flowchart.png)

Browser **5 คำขอหลัก** และ script ส่งต่อ 3 เส้น กดลิงก์จาก C เพิ่ม `/connect/:system` อีก 1 ครั้ง ไม่รวม polling/status การไม่ถามรหัสผ่านซ้ำอาศัย session C ไม่ใช่ native Keycloak cookie ไม่มี token ร่วมใน localStorage

## F05 — ไม่มีสิทธิ์ ไม่มีบัญชี หรือข้อมูลไม่ถูกต้อง

Modal ไม่มีสิทธิ์แสดงจากคำขอที่ผู้ใช้กด SSO เองเท่านั้น ไม่เด้งซ้ำหลัง reload หรือ silent check

```mermaid
sequenceDiagram
    autonumber
actor U as User / Browser
    participant C as ระบบ C
    participant K as Keycloak + ส่วนขยาย
    participant A as ระบบ A หรือ B
    U->>C: คำขอ SSO
    alt ไม่มี read ใน C
        C-->>U: Redirect callback error access_denied พร้อม state
        U->>A: GET /sso/callback
        A-->>U: Redirect Login และ modal ครั้งเดียว
    else มีสิทธิ์
        C-->>U: proof ในฟอร์ม
        U->>K: POST proof
        alt หลักฐานผิดหรือใช้ซ้ำ
            K-->>U: ปฏิเสธในเฟรม
            Note over U,A: หน้าส่งต่อ timeout กลับ Login พร้อม connection modal
        else หลักฐานผ่าน
            K-->>U: ฟอร์ม token ไป A/B
            U->>A: POST /sso/callback
            alt JWT หรือ binding ผิด
                A-->>U: HTTP 400 ไม่สร้าง session
            else ไม่มี read หรือไม่มี local account
                A-->>U: Redirect Login พร้อม modal ตามเหตุผล
            end
        end
    end
```

[เปิดภาพ PNG: F05 sequence](images/f05-sequence.png)

```mermaid
flowchart TD
S[คำขอ SSO] --> C{C มี read?}
    C -->|ไม่มี| D[access_denied กลับ Login A/B]
    C -->|มี| K{Keycloak ตรวจ proof ผ่าน?}
    K -->|ไม่| E[ปฏิเสธการส่งต่อ token]
    K -->|ผ่าน| T[ส่ง token เข้า A/B]
    T --> V{JWT และ binding ผ่าน?}
    V -->|ไม่| B[400]
    V -->|ผ่าน| A{มีสิทธิ์และ local account?}
    A -->|ไม่| M[Login พร้อม modal ครั้งเดียว]
    A -->|มี| H[สร้าง session แอป]
```

[เปิดภาพ PNG: F05 flowchart](images/f05-flowchart.png)

C ไม่ให้ read จึงไม่ส่ง proof ไปขอส่งต่อ token; A/B ตรวจซ้ำจาก JWT ก่อนสร้าง session ไม่มีบัญชีใน A/B จะไม่สร้างให้อัตโนมัติ หากข้อมูลปลอมถูกปฏิเสธในเฟรม หน้าส่งต่อจะแสดง connection error แบบทั่วไปหลัง timeout ไม่เปิดเผยรายละเอียดตรวจลายเซ็นให้ผู้ใช้

## F06 — Keycloak ติดต่อไม่ได้หรือออก token ไม่ได้

รองรับทั้งล่มก่อนเริ่ม SSO และล่มหลัง preflight ผ่าน ไม่ปล่อยหน้าหลัก browser ไปค้างที่หน้า Keycloak

```mermaid
sequenceDiagram
    autonumber
actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant C as ระบบ C
    participant K as Keycloak + ส่วนขยาย
    U->>A: POST /sso/preflight
    loop สูงสุด 3 ครั้งเฉพาะ error ที่ retry ได้
        A->>K: GET /temporary-sso-poc/status
        K--xA: timeout หรือ server error
    end
    A-->>U: 503 และจำนวน attempts
    U->>U: แสดง modal คงหน้า Login
    Note over U,K: อีกกรณี ตรวจพร้อมผ่านแล้วแต่ล่มระหว่างส่งต่อ
    U->>C: ยืนยันตัวตนและรับหน้าส่งต่อ
    C-->>U: ฟอร์ม proof และ timeout 12 วินาที
    U->>K: POST proof ในเฟรม
    K--xU: ติดต่อไม่ได้หรือออก token ไม่สำเร็จ
    U->>A: GET error callback หลัง timeout
    A-->>U: กลับ Login พร้อม connection modal
```

[เปิดภาพ PNG: F06 sequence](images/f06-sequence.png)

```mermaid
flowchart TD
S[กด SSO] --> P{Keycloak พร้อม?}
    P -->|ไม่| R[retry สูงสุด 3 ครั้ง]
    R -->|ยังไม่ผ่าน| E[คง Login แสดง modal]
    P -->|ผ่าน| C[ไป C และส่ง proof ในเฟรม]
    C --> T{callback สำเร็จใน 12 วินาที?}
    T -->|ใช่| H[เข้า A/B]
    T -->|ไม่| F[กลับ error callback A/B]
    F --> E
```

[เปิดภาพ PNG: F06 flowchart](images/f06-flowchart.png)

Retry ตรวจพร้อมเว้น 2 และ 5 วินาที แต่ละคำขอ timeout 3 วินาที Silent check ตรวจเพียง 1 ครั้ง HTTP 4xx ที่ไม่ใช่ 429 หรือ issuer ผิดหยุดทันที ไม่ retry การส่ง proof โดยอัตโนมัติ ผู้ใช้เริ่มใหม่เพื่อรับ state/proof ใหม่ Login local ยังใช้ได้ หาก Login C โดยตรงแล้วเชื่อมต่อไม่ได้ C session คงอยู่และมีสถานะแจ้งบน dashboard

Login C โดยตรงใช้ POST bootstrap สูงสุด 3 ครั้งเพื่อออก token จริง ไม่ใช้ GET status มาตัดสินว่าสำเร็จ หากออกไม่ได้ C local session ยังใช้ได้ แต่ tokenIssued เป็น false และมี modal แจ้ง failed

## F07 — Heartbeat ตรวจ expiry หรือ revoke

Browser ตั้งรอบ 1 ชั่วโมง Protected requests ตรวจ JWT expiry ด้วย เมื่อพบ inactive จะล้าง session และกลับหน้า Login

```mermaid
sequenceDiagram
    autonumber
actor U as User / Browser
    participant A as ระบบ A หรือ B
    participant K as Keycloak + ส่วนขยาย
    U->>A: GET /session/heartbeat ทุก 1 ชั่วโมง
    A->>A: ตรวจ JWT กลางและ app token รวม exp
    alt หมดอายุหรือ token ไม่ถูกต้อง
        A->>A: ล้าง session
        A-->>U: 401 พร้อม loginUrl
        U->>A: GET /login
    else token ยังไม่หมดอายุ
        A->>K: POST /temporary-sso-poc/introspect พร้อม client auth
        alt active
            K-->>A: active true
            A-->>U: 200 ใช้งานต่อ
        else inactive
            K-->>A: active false
            A->>A: ล้าง SSO session
            A-->>U: 401
            U->>A: GET /login
        else ติดต่อไม่ได้
            K--xA: timeout / error
            A-->>U: 503 ยังไม่สรุปว่า revoke
        end
    end
```

[เปิดภาพ PNG: F07 sequence](images/f07-sequence.png)

```mermaid
flowchart TD
H[ครบ 1 ชั่วโมงหรือคำขอที่ต้องตรวจ] --> V{JWT และ exp ผ่าน?}
    V -->|ไม่| L[ล้าง session และกลับ Login]
    V -->|ผ่าน| I[Introspect กับส่วนขยาย]
    I --> R{ผลตรวจ}
    R -->|active| S[ใช้ต่อ]
    R -->|inactive| L
    R -->|ติดต่อไม่ได้| W[503 รอตรวจใหม่]
```

[เปิดภาพ PNG: F07 flowchart](images/f07-flowchart.png)

Browser heartbeat 1 request; Keycloak introspection **0–1** ตามว่า token ยังผ่าน exp หรือไม่ Protected requests ตรวจ introspection เมื่อเกินรอบ 1 ชั่วโมง ส่วน local sessions ไม่ขึ้นกับ Keycloak การทดสอบเร่ง timer จากภายนอกและตั้ง token 3 วินาทีชั่วคราว ไม่เปลี่ยนรอบจริงของ source และคืนอายุ 15 นาทีเมื่อจบ หากไม่เปิดหน้าใช้งาน token หมดอายุอาจรอถึง heartbeat ถัดไปจึงเปลี่ยนหน้า

## F08 — Logout A/B เฉพาะระบบ

Logout นี้ไม่ revoke token กลางหรือ Logout C และอีกแอป

```mermaid
sequenceDiagram
    autonumber
actor U as User / Browser
    participant A as ระบบ A หรือ B
    U->>A: POST /logout พร้อม CSRF
    A->>A: ล้าง session และ cookie ของระบบนี้
    A-->>U: Redirect /login/local
    U->>A: GET /login/local
    A-->>U: Redirect /login
    U->>A: GET /login
    A-->>U: หน้า Login ไม่เริ่ม silent SSO ซ้ำ
```

[เปิดภาพ PNG: F08 sequence](images/f08-sequence.png)

```mermaid
flowchart TD
L[Logout A/B] --> C{CSRF ผ่าน?}
    C -->|ไม่| E[403]
    C -->|ผ่าน| D[ล้าง session และ cookie ของระบบนี้]
    D --> H[หน้า Login รอผู้ใช้เลือกช่องทาง]
```

[เปิดภาพ PNG: F08 flowchart](images/f08-flowchart.png)

Browser 3 requests ตามภาพ Keycloak **0** หากผู้ใช้กด SSO ใหม่และ C session ยังอยู่จะเข้าได้โดยไม่ถามรหัสผ่าน API revoke รายใบมีให้ทดสอบแยก แต่ไม่ได้ผูกกับปุ่ม Logout นี้

## F09 — Logout C ยกเลิก token กลางและบังคับ SSO A/B ออก

C ลงลายเซ็น logout proof โดยไม่ถือ token กลางของ A/B แล้วส่ง notification ให้แอปหลัง Keycloak ยกเลิกสถานะ

```mermaid
sequenceDiagram
    autonumber
actor U as Browser C
    participant C as ระบบ C
    participant K as Keycloak + ส่วนขยาย
    participant A as ระบบ A/B
    actor B as Browser A/B
    U->>C: POST /logout พร้อม CSRF
    C->>C: ปิด C session ต้นทางและสร้าง signed logout proof
    C->>K: POST /temporary-sso-poc/logout-user
    K->>K: ตรวจ proof ลบตัวตน/token cache และตั้ง cutoff ชั่วคราว
    K-->>C: สำเร็จ
    loop app-a และ app-b
        C->>A: POST /logout/control พร้อม signed notification
        A->>A: ตรวจลายเซ็น บันทึก cutoff และล้าง SSO sessions
        A-->>B: SSE logout บน connection เดิม
        B->>A: เปิดหน้า Login
        A-->>C: HTTP 200
    end
    C->>C: ล้าง session C
    C-->>U: Redirect /login
```

[เปิดภาพ PNG: F09 sequence](images/f09-sequence.png)

```mermaid
flowchart TD
L[Logout C] --> P[ปิดต้นทางและลงลายเซ็น proof]
    P --> K[Keycloak ลบสถานะ token ของ user]
    K --> N[แจ้ง A และ B ด้วย signed notification]
    N --> R{ทุกขั้นตอนสำเร็จ?}
    R -->|สำเร็จ| C[ล้าง session C แล้วกลับ Login]
    R -->|ไม่| E[503 คง C session ให้ retry]
```

[เปิดภาพ PNG: F09 flowchart](images/f09-flowchart.png)

Backend **C→Keycloak 1 + C→A/B 2 requests** ไม่วน revoke ทีละใบ และไม่ใช้ native End Session หรือ native back-channel logout A/B ล้างเฉพาะ SSO sessions ส่วน local sessions คงอยู่ SSE เป็นข้อมูลใน connection เดิมไม่ใช่ request ใหม่ ไม่มีการ rollback การ revoke ที่สำเร็จแล้วหาก notification ถัดไปล้มเหลว จึงอาจเกิด logout บางส่วนและต้อง retry

การ revoke นี้รวม token กลางของ C และ token ของ A/B ด้วย C ล้าง access_token ของตัวเองจาก central_sso_status และไม่รับ token A/B มาส่งต่อ

## F10 — จัดการบัญชีและสิทธิ์ที่ C

หน้า user management ใช้งานกับฐานข้อมูล C จริง ไม่มี sync button หรือการสร้าง Keycloak user/roles

```mermaid
sequenceDiagram
    autonumber
actor U as ผู้ดูแล / Browser
    participant C as ระบบ C
    participant D as PostgreSQL C
    participant K as Keycloak + ส่วนขยาย
    participant A as ระบบ A/B
    U->>C: POST /users หรือ /users/{id}
    C->>C: ตรวจ admin และ CSRF
    C->>D: บันทึกบัญชี/สิทธิ์และ audit
    D-->>C: สำเร็จ
    opt แก้สิทธิ์ ปิดบัญชี เปลี่ยนรหัสผ่าน หรือลบผู้ใช้เดิม
        C->>K: POST /temporary-sso-poc/logout-user พร้อม signed proof
        K-->>C: ยกเลิก token เดิม
        C->>A: signed notification ล้าง SSO sessions
    end
    C-->>U: Redirect /users?saved=1
    Note over C,K: SSO ครั้งใหม่อ่านสิทธิ์ล่าสุดเพื่อสร้าง proof ไม่ sync ผู้ใช้/roles
```

[เปิดภาพ PNG: F10 sequence](images/f10-sequence.png)

```mermaid
flowchart TD
S[บันทึกบัญชีและสิทธิ์ใน C] --> V{admin CSRF และข้อมูลผ่าน?}
    V -->|ไม่| E[ปฏิเสธ]
    V -->|ผ่าน| D[บันทึก PostgreSQL C]
    D --> T{เป็นการแก้ผู้ใช้เดิมหรือไม่?}
    T -->|สร้างใหม่| H[สำเร็จ ไม่เรียก Keycloak]
    T -->|แก้หรือปิดหรือลบ| K[revoke ผู้ใช้และแจ้ง Logout A/B]
    K -->|ผ่าน| H
    K -->|ไม่ผ่าน| F[แจ้งดำเนินการไม่สำเร็จ ต้อง retry]
    H --> N[SSO ใหม่ได้รับสิทธิ์ล่าสุด]
```

[เปิดภาพ PNG: F10 flowchart](images/f10-flowchart.png)

สร้างผู้ใช้ใหม่ **Keycloak 0 requests** แก้ผู้ใช้เดิมใช้ logout-user 1 และ notification 2 ไม่ใช่ sync ผู้ใช้ Token payload ที่ออกแล้วเปลี่ยนไม่ได้จึง revoke และให้เริ่ม SSO ใหม่ หาก network revoke ล้มเหลว ข้อมูลที่บันทึกใน C ไม่ rollback ต้อง retry เพื่อยกเลิก token เดิมให้ครบ การปิด/ลบ/เปลี่ยนรหัสผ่านมีในโค้ด; integration suite ทดสอบหน้าเพิ่มผู้ใช้และแก้สิทธิ์ ไม่ได้ทดสอบทุกกรณีของการลบบัญชี
