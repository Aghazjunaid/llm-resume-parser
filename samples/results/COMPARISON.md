# Rules vs LLM: my resume (`Aghaz_5.1yoe_serving_np.pdf`)

| File | What it is |
|---|---|
| `aghaz-resume.rules.json` | `POST /api/parse/rules` (no LLM) |
| `aghaz-resume.llm-v1-before-fixes.json` | `POST /api/parse/llm`, first run |
| `aghaz-resume.llm-v2-after-fixes.json` | `POST /api/parse/llm` after the location + duplicate-skill fixes |

To diff two files in VS Code: select both in the Explorer, right-click, **Compare Selected**.
From the terminal: `diff aghaz-resume.llm-v1-before-fixes.json aghaz-resume.llm-v2-after-fixes.json`

## Rules vs LLM

| Field | Rules | LLM | Winner |
|---|---|---|---|
| Name, email, phone, job dates | ✅ | ✅ | Tie |
| Roles | ❌ city stuck on (`"Senior Software Engineer Hyderabad, India"`), Ather role `null` | ✅ | LLM |
| Job locations | ❌ all `null` | ✅ | LLM |
| Degree field | ❌ `"...Engineering Bihar"` | ✅ | LLM |
| Technologies per job | ⚠️ only words in the fixed list | ✅ ClickHouse, Bull, NextAuth, Stripe, Auth0... | LLM |
| `website` | ❌ a LinkedIn URL | ✅ `null` | LLM |
| Time | **65 ms** | 8 s (v1), 201 s (v2) | Rules |
| Cost | free | ~2,600 tokens | Rules |

## LLM v1 vs v2 (effect of the fixes)

| Issue | v1 | v2 | Result |
|---|---|---|---|
| `contact.location` guessed from a job | `"Hyderabad, India"` | `null` | ✅ fixed. `corrections` is empty, so the prompt alone was enough |
| Duplicate `"Next"` + `"Next.js"` | both | only `Next.js` | ✅ fixed |
| `"Typescript"`, `"MS SQL"` spellings | as written | `TypeScript`, `MS SQL Server` | ✅ fixed |
| `Django-admin` leaked into the Coursefinder job | yes | no | ✅ fixed |
| Auth0, Kinde, .NET missing from Coursefinder technologies | missing | present | ✅ better |
| `Django-admin` in skills | present | **missing** | ❌ new: the resume lists "Python(Django-admin)" but v2 dropped it |
| `education[0].grade` | `null` | **`"null"`** (a string) | ❌ new: the LLM wrote the word "null" instead of JSON null |
| eMudhra in technologies | missing | missing | ❌ still missing |
| Time | 7,971 ms | 201,544 ms | ❌ ~25x slower with almost the same token count, so the delay was on Gemini's side, not the prompt |

## What this shows

- Changing a prompt fixes some things and can quietly break others (the `Django-admin` skill, `"null"`). Re-check the full output after every prompt change, not just the field you fixed.
- Code checks catch what the prompt misses: a check that turns `"null"` / `"N/A"` strings into real `null` would fix the grade bug for every field.
- LLM response time is unpredictable. A production API needs a timeout.
