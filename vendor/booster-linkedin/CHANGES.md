# Business Booster runtime changes

## 4.29.0+booster.1 — 2026-11-03

The read-only confirmation branch in `linkedin/message_sender.py` recognizes
LinkedIn's thread without a composer after the first message, while awaiting a
reply. This DOM shape was observed in an existing user-authorized conversation;
no message was sent during diagnosis.

The narrow `main .msg-thread` selector applies only to confirmation. It never
authorizes a click or creates an InMail. Confirmation still requires the pinned
route, unique recipient header, exact text, a new server message URN outside the
pre-submit baseline, and an outgoing sender matching that URN's account. A missing
editor alone never confirms a send. Existing route-transition checks remain.

`booster_recruiter.send_confirmation_check` exercises successful and rejected
cases in real Chromium with locally fulfilled HTML. The local version suffix
ensures an existing Windows build environment reinstalls the changed vendor
package instead of retaining an older wheel.
