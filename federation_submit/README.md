# Federation calendar bulk submission

Submits Chabad of St. Petersburg's 102 events to the Jewish Federation of
Florida's Gulf Coast community calendar:
**https://www.jewishgulfcoast.org/calendar/submit**

The form is protected by **reCAPTCHA v2**. This script is built to run on **your
own computer** with a **visible browser window** on your **home/office internet**,
where reCAPTCHA almost always passes on a single checkbox click. When it does
throw an image challenge, the run **pauses and waits for you** to solve it in the
window, then continues. (It will not work from a datacenter/cloud IP, which is
challenged on every attempt — that's why this couldn't be completed inside the
Claude session.)

Progress is written to `submit_log.csv` after **every** event, so if you stop or
it pauses, just run it again and it **resumes** where it left off (it skips any
`num` already marked `submitted`). A full-page screenshot of each event is saved
to `screenshots/`.

## Easiest way — double-click launcher

- **macOS:** double-click **`run.command`** (right-click → Open the first time, to
  clear the "unidentified developer" prompt).
- **Windows:** double-click **`run.bat`**.
- **Linux:** run **`./run.sh`**.

It installs what's needed on first run, then asks whether to do a single test
event (#1) or the full batch. That's all — the identity and every field are
already baked in. The manual steps below do the same thing if you prefer a
terminal.

## 1. One-time setup

Install Node.js 18+ (https://nodejs.org), then in this folder:

```bash
npm install playwright@1.56.1
npx playwright install chromium
```

The submitter/contact identity is pre-filled as **Chabad Team /
Info@chabadsp.com** (used for both "Your Details" and the event contact). No
env vars needed unless you want to override it.

## 2. Prove event #1 first (do this before the full run)

```bash
START_AT=1 STOP_AT=1 node submit_events.js
```

A Chromium window opens and fills event #1. Click the reCAPTCHA checkbox if it's
waiting (or solve the challenge if one appears). Confirm the page shows a
success / "thank you" / "submitted for review" message, and check
`screenshots/event_001.png` and `submit_log.csv`. **Only continue if #1 clearly
succeeded.**

## 3. Run the rest

```bash
node submit_events.js
```

It processes every remaining row in order, ~2–4s apart, pausing for you on any
reCAPTCHA challenge, and prints a progress line every 10 events. Re-run the same
command anytime to resume.

## Environment variables

| Var | Purpose |
| --- | --- |
| `SUBMITTER_FIRST` / `SUBMITTER_LAST` / `SUBMITTER_EMAIL` | **Required.** The form's "Your Details" (submitter). Reused as the event contact via "I am the event contact." |
| `START_AT` / `STOP_AT` | Optional `num` bounds. e.g. `START_AT=1 STOP_AT=1` for only event #1. |
| `CAPTCHA_WAIT_MS` | How long to wait for you to solve a challenge (default `300000` = 5 min). |
| `HEADLESS=1` | Run with no window. **Not recommended** — reCAPTCHA will block it. |
| `USE_PROXY=1` | Only for running inside the Claude sandbox. Leave unset on your machine. |

## Field mapping (as verified against the live form)

| Form field | CSV column | Notes |
| --- | --- | --- |
| Title | `title` | verbatim (keeps the "Chabad SP – " prefix) |
| Start / End Date | `start_date` / `end_date` | typed verbatim, e.g. "August 7, 2026 07:00 PM" |
| All Day | `all_day == "Yes"` | end date is disabled by the form for all-day (single-day) |
| This Event will Repeat | `repeats` non-empty | Frequency=Weekly, interval 1, "On Certain Days" + the named weekday, "Until" = the date after "through" |
| Description | `description` | plain text |
| Location Name | `location_name` | |
| Address Line 1 | `address` | |
| City | `city` | |
| Zip/Postal Code | `zip` | |
| State/Province | `state` | `FL` → Florida |
| Country | (default) | United States |
| Your Details + Contact | from env | required by the form |

All other fields are left blank, per the instructions.

## Rows to double-check afterward (flagged in the CSV `notes` column)

- **#8 Sukkot Under the Stars** — time guessed 7:00 PM (none in email).
- **#27 Kiddush & Cocktails (Nov 20)** — time guessed 6:00 PM (none in email).
- **#46 The S. Pete Jewish Experience** — description copied verbatim (has a typo).
- **#96 Camp Gan Israel Begins** — all-day, no time.
- **#98 Camp Gan Israel Ends** — all-day, no time.
- **#100 Men's Tanya Class** — CSV lists the Chabad Center address, but the note
  says it's actually at the **Korf residence**. Submitted as written in the CSV —
  confirm/fix the address.
