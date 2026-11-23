# Android automation (Tasker / MacroDroid)

Goal: when you **unlock** your phone in the morning PIMS suggests a *login*, and when you **lock** it in the evening PIMS suggests a *logout*. Your phone only reports "unlocked" / "locked" — PIMS decides whether that is worth suggesting, and **you confirm** it in the app (unless you turn on auto-confirm). Nothing is ever recorded silently by default, and the manual Clock in / Clock out buttons always work.

> Menu names differ slightly between Tasker/MacroDroid versions. The values you must get right are the URL, the `Authorization` header, the `Content-Type` and the JSON body — those are identical in both apps.

## 1. Create a device token

1. In PIMS open **Settings → Automation**.
2. Under *Device tokens* type a label (e.g. "My Pixel") and press **Create token**.
3. Copy the token (`pims_…`) from the dialog. **It is shown only once.** If you lose it, revoke it and create a new one.

Also copy the **URL** shown in the *Webhook* card — it is `https://<your-worker-host>/api/device/event`.

## 2. What the phone must send

```
POST https://<your-worker-host>/api/device/event
Authorization: Bearer pims_xxxxxxxxxxxxxxxx
Content-Type: application/json

{"event":"unlock","device":"My Pixel"}
```

| Field | Required | Notes |
| --- | --- | --- |
| `event` | yes | `unlock` or `lock` |
| `device` | no | free-text label shown in the event list |
| `timestamp` | no | If omitted the server time is used (recommended). If you send one: ISO-8601 with offset (`2026-11-05T09:58:00+06:00`), epoch seconds/milliseconds, or `YYYY-MM-DD HH:MM` (read as Dhaka time). Must be at most 7 days old and at most 10 minutes in the future. |

Send a timestamp only if your automation may deliver late (phone was offline); then the event keeps the time it really happened.

## 3. Tasker

Create two profiles.

**Profile "PIMS unlock"**

- *Event* → Display → **Display Unlocked**
- Task, action **Net → HTTP Request**:
  - Method: `POST`
  - URL: `https://<your-worker-host>/api/device/event`
  - Headers (one per line):
    ```
    Authorization: Bearer pims_xxxxxxxxxxxxxxxx
    ```
  - Body: `{"event":"unlock","device":"My Pixel","timestamp":%TIMES}`
  - Content Type: `application/json`
  - Timeout: 30 s

`%TIMES` is Tasker's built-in "seconds since the epoch" variable, so the event keeps the exact moment even if the request is retried.

**Profile "PIMS lock"**

- *Event* → Display → **Display Off** (the phone locks when the screen turns off; with a lock-delay setting it locks slightly later, which is fine — PIMS uses the latest lock of the evening).
- Same HTTP Request, with body `{"event":"lock","device":"My Pixel","timestamp":%TIMES}`.

Optional: add a *State → Net → Wifi Connected* (your office Wi-Fi) context to the profiles so events fire only at the office. PIMS also applies its own time-of-day rules, so this is not required.

Test: run each task manually (▶ in the task editor). Check **Attendance → Device events** in PIMS.

## 4. MacroDroid

Create two macros.

**Macro "PIMS unlock"**

- Trigger: Device Events → **Device Unlocked**
- Action: Connectivity → **HTTP Request**
  - Method: `POST`, URL as above
  - Content body: `{"event":"unlock","device":"My Pixel"}`
  - Content type: `application/json`
  - Header: `Authorization` = `Bearer pims_xxxxxxxxxxxxxxxx`
  - Leave *Block next actions until complete* off, and (if offered) retry on failure.

**Macro "PIMS lock"**

- Trigger: Device Events → **Screen Off** (or **Device Locked** if your version has it)
- Same action with body `{"event":"lock","device":"My Pixel"}`.

(Leave out `timestamp` in MacroDroid unless you know the magic-text variable for the current epoch time in your version — the server time is accurate enough when the phone is online.)

## 5. Keep the automation alive

Android may stop background apps. For Tasker/MacroDroid:

- Settings → Apps → *Tasker/MacroDroid* → Battery → **Unrestricted / Don't optimise**.
- Allow *auto-start* / *run in background* on phones that have that setting (Xiaomi, Oppo, Samsung "sleeping apps").
- Keep the app's persistent notification enabled.

## 6. What PIMS does with each event

| Event | PIMS creates a *pending suggestion* when… | Otherwise the event is stored as **ignored** with a reason |
| --- | --- | --- |
| `unlock` | you have no login today, today is a working day, the time is inside the **login window** (default 06:00–13:00), and no login suggestion is already waiting | `already_logged_in_today`, `non_working_day`, `outside_login_window`, `login_already_suggested` |
| `lock` | you have a login today, the time is after **Suggest logout after** (default 16:00), and it is later than any logout already recorded. A newer lock replaces an older pending one. | `no_login_today`, `before_logout_window`, `older_than_recorded_logout` |

- Two identical events within a minute are collapsed (`duplicate`).
- A pending suggestion shows on the Dashboard, the Attendance page and as a bell in the top bar. **Confirm** writes the login/logout (labelled *Auto* in the attendance table because it came from the phone); **Dismiss** discards it.
- **Settings → Automation** lets you turn the whole feature off (events are then ignored with `automation_disabled`), turn on **auto-confirm**, and change the login window and logout time.
- Every confirmation and correction is in **Attendance → Audit trail**.

## 7. Test without a phone

```bash
curl -X POST https://<your-worker-host>/api/device/event \
  -H "Authorization: Bearer pims_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"event":"unlock","device":"curl test"}'
```

A `200` with `"status":"pending"` means a suggestion is waiting; `"status":"ignored"` includes a `reason` (for example `outside_login_window` if you test in the evening). `401` means the token is wrong or revoked.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| 401 `Missing bearer token` | The header must read `Authorization: Bearer <token>` — note the word `Bearer` and the space. |
| 401 `Invalid or revoked token` | Create a new token in Settings → Automation. |
| 400 `Send a JSON body…` | Content type must be `application/json` (a form body is also accepted). |
| 400 `Timestamp is in the future / more than 7 days old` | Check the phone's clock, or omit `timestamp`. |
| Events arrive but nothing is suggested | Open **Attendance → Device events**; the `reason` on the event says why (outside the login window, already logged in, not a working day…). |
| Nothing arrives at all | Battery optimisation is killing the app, the phone is offline, or the URL has a typo. Test with curl first. |
| Request blocked by a corporate/VPN proxy | The Worker URL must be reachable from the phone's network. |
