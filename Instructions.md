Here’s the **concise architecture** we’ve agreed on:

---

# 🧠 CORE MODEL

Separate responsibilities:

1. **AI → understanding**

   * extract structured data
   * choose next question

2. **State → source of truth**

   * all applicant answers stored as fields

3. **Rule Engine → decisions**

   * deterministic evaluation (no AI)

---

# 🧑‍💼 LANDLORD SETUP

1. Landlord inputs description
2. AI generates:

   * **structured rules** (field + operator + value)
   * **questions** (only for fields used in rules)
   * **messages**
3. Landlord reviews & edits
4. Save config

---

# 💬 APPLICANT FLOW

Loop per message:

1. AI extracts fields → update state
2. Rule engine evaluates:

   * fail → reject (with reason)
   * pass → continue
3. AI selects next unanswered question
4. Repeat until complete → show links

---

# 🧱 RULE SYSTEM

* Fully dynamic (AI-generated)
* Format: **field + operator + value**
* Evaluated in code (not AI)
* No hardcoded rule types

---

# 🔑 KEY RULES

* No default rules anywhere
* AI never decides pass/fail
* Questions come from rules
* Only predefined fields allowed
* Fail fast on violations

---

That’s the system: **AI interprets, code decides, data drives everything.**
