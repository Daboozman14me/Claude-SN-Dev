# Project setup interview

The scaffolding agent asks these questions once, at the start of a project
(or for an existing project that has no recorded setup), and records the
answers as `setup` on the project's entry in the program manifest. Later
agents read them with `npm run setup:show -- "<application>"`:

- the supervisor's code-writer intake **prefills** app form, location, scope
  and instance and asks the user to confirm each one;
- deploy instructions use the recorded GitHub environment and auth type;
- the backlog agent uses the recorded Agile framework, team, product and
  numbering.

Each section is recorded as `answered`, `default`, or `skipped` (with a
note), so a small change can skip most of it. Answers are names, choices and
confirmations only — never a password, token, or secret value.

## Sections and why they exist

| Section | Questions | Lesson behind it (New Conf Room Booking) |
|---|---|---|
| project | Fluent or classic; new or existing app; scope; local folder | The first install failed because the scope prefix no longer matched the instance company code; the app had to be renamed |
| instances | Each instance and its purpose (dev, test, prod) | Deploys must target a confirmed instance, never the connected default |
| instanceAccess | The `now-sdk auth` alias; does the instance block basic-auth API calls for human users? | It did — three deploys failed before the syslog showed why |
| deploy | GitHub Actions, browser update-set import, or manual; repo; one GitHub environment per instance; basic or OAuth; deploy user (Human or Machine); secrets created? | OAuth installs need a Human deploy user; a Machine user passes API checks but `now-sdk install` refuses it |
| agile | Use ServiceNow Agile? Classic, SAFe or CWM; is its menu active; team and members; product; numbering start | Agile 2.0 isn't offered on Australia PDIs; SAFe was installed; the classic Agile menu was inactive; boards filter by team and product; Import XML assigns no numbers |
| quality | ATF enabled or deferred; runtime access tracking enforcing or permissive; who decides findings | Enforcing blocked core platform APIs at runtime until permissive was chosen; ATF needs a scheduled runner in its own browser session |
| decisions | Where the owner-decisions log lives | Every agent cites decisions from one file |

## Read-only checks the interview makes

Company code (`glide.appcreator.company.code`), whether the scope exists,
Agile tables and the chosen framework's menu, `sys_number` counters,
existing team/product names, and member sys_ids. The agent records what it
checked and asks again when an answer contradicts the instance.

## What the owner still does

Create the repo (from the generated request), the GitHub environment and its
secrets (the agent prints the names), activate a menu if wanted, and the
deploy user on the instance. The interview's read-back lists whatever is
still open.
