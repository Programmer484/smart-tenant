# Chatbot Approach

Single source of truth for how the screening chatbot works — architecture, LLM integration, extraction, conversation lifecycle, and landlord controls.

## Design principles

1. **Positive tenant experience** — conversational, never feels like an interrogation. One question at a time. Answers property questions when the info is available.
2. **Landlord control** — structured settings for behavioral boundaries plus freeform style/example customisation.
3. **Deterministic where possible** — rule evaluation, value validation, and conversation lifecycle are handled in code, not by the LLM. The LLM's job is to talk and extract, not to make policy decisions.

## Architecture overview

```
Applicant ──► Chat page (client) ──► /api/chat (server) ──► Claude API (tool_use)
                  │                        │
                  │ state:                 │ server-side:
                  │  offTopicCount         │  validate extractions
                  │  qualifiedFollowUps    │  evaluate rules
                  │  clarificationPending  │  enforce lifecycle
                  │  answers               │  persist to Supabase
                  │                        │
                  ◄────────────────────────┘
                    { reply, extracted, sessionStatus, offTopicWarning }
```

Client tracks counters. Server validates, evaluates rules, enforces lifecycle, and persists. The LLM generates replies and extractions via structured tool use.

## LLM integration: tool use

We use Claude's native `tool_use` instead of asking for JSON inside a freeform response. This gives us schema-enforced structured output.

### Tool definition: `screen_response`

```json
{
  "name": "screen_response",
  "description": "Respond to the applicant and extract any screening field values from their message.",
  "input_schema": {
    "type": "object",
    "properties": {
      "reply": {
        "type": "string",
        "description": "Your conversational message to the applicant."
      },
      "extracted": {
        "type": "array",
        "description": "Field values found in the applicant's message. Empty array if none.",
        "items": {
          "type": "object",
          "properties": {
            "fieldId": { "type": "string" },
            "value": { "type": "string" }
          },
          "required": ["fieldId", "value"]
        }
      },
      "message_relevant": {
        "type": "boolean",
        "description": "true if the message is a screening answer OR a property question. false if off-topic."
      }
    },
    "required": ["reply", "extracted", "message_relevant"]
  }
}
```

Forced with `tool_choice: { type: "tool", name: "screen_response" }`.

### Why tool use over JSON-in-prompt

- Schema enforcement: Claude validates the output structure before returning it
- No regex/JSON.parse cleanup needed
- Extraction is more reliable because the schema clearly separates reply from data
- `message_relevant` classification is a typed boolean, not buried in freeform text

## Value validation

After receiving the tool call result, each extraction is validated in code:

| valueKind | Validation rule |
|-----------|----------------|
| number    | `!isNaN(Number(value))` |
| boolean   | value is "true" or "false" (case-insensitive) |
| date      | `!isNaN(Date.parse(value))` |
| enum      | value matches one of the field's `options` (case-insensitive) |
| text      | always valid |

Invalid extractions are silently dropped — they never reach the rule engine or the client's answers state.

## System prompt structure

The system prompt is built dynamically per request:

1. **Role and property context** — property title and description
2. **Eligibility requirements** — human-readable rules
3. **Collected answers** — what we already know
4. **Still needed fields** — with `collectHint` per field when available
5. **Behavioral instructions**:
   - Extraction emphasis: "You MUST extract ALL values matching STILL NEED fields."
   - Grounding: controlled by `unknownInfoBehavior` setting
   - One question at a time
6. **Landlord style instructions** — freeform text (if provided)
7. **Example conversations** — Q&A pairs (if provided)

No JSON output format instructions — the tool schema handles that.

## Conversation lifecycle

### State machine

```
                    ┌──────────────────────────┐
                    │                          │
                    v                          │
[start] ──► IN_PROGRESS ──► QUALIFIED ──► COMPLETED
                │   │            │
                │   │            └──► COMPLETED (off-topic)
                │   │
                │   └──► REJECTED (off-topic >= limit)
                │
                └──► CLARIFYING ──► IN_PROGRESS (corrected)
                         │
                         └──► REJECTED (still violates)
```

### Off-topic system

Tracks messages that are neither screening answers nor property questions.

- **Counter**: `offTopicCount` (client state, sent with each request)
- **Limit**: `offTopicLimit` (landlord setting, default 3, 0 = unlimited)
- **Trigger**: `message_relevant === false` from the tool call
- **Behavior**: when count >= limit, override reply with a polite close and set status to `rejected`
- **Scope**: active during `in_progress` and `qualified` phases

### Rule violation system (two-strike)

Completely independent from off-topic. Triggered by deterministic rule evaluation in code.

- **Strike 1**: `clarificationPending = false` and a violation is found → set status to `clarifying`, override reply with "you may not meet this requirement: [reason]. If incorrect, let us know."
- **Strike 2**: `clarificationPending = true` and the violation persists → set status to `rejected`, override reply with a final close.
- **Not configurable** — always two strikes. If a hard rule is violated twice, the conversation ends.

### Qualified phase

Reached when all required fields are collected AND all rules pass.

- **Counter**: `qualifiedFollowUps` (client state)
- **Limit**: `qualifiedFollowUps` setting (landlord, default 3, 0 = close immediately)
- **Behavior**: the applicant can ask follow-up questions (on-topic only). Each response increments the counter. When count >= limit OR an off-topic message arrives, override with a closing message and set status to `completed`.
- `completed` is a terminal state distinct from `rejected` — green banner, not red.

## Landlord behavioral settings

Stored in the `ai_instructions` JSONB column on `properties`. No DB migration needed.

```typescript
type AiInstructions = {
  style: string;                              // freeform tone/behavior
  examples: AiExample[];                      // sample Q&A pairs
  offTopicLimit: number;                      // default 3, 0 = unlimited
  qualifiedFollowUps: number;                 // default 3, 0 = close immediately
  unknownInfoBehavior: "deflect" | "ignore";  // default "deflect"
};
```

### unknownInfoBehavior

- `"deflect"`: "I don't have that information — please contact the landlord directly."
- `"ignore"`: silently redirect back to screening without acknowledging the question.

### UI

All settings live in the existing "AI Behavior" tab on the property setup page. Structured controls (number inputs, radio buttons) appear alongside the freeform style instructions and example conversations.

## Anti-hallucination

The system prompt includes explicit grounding:

- When `unknownInfoBehavior = "deflect"`: "Only answer property questions using the description above. If the information isn't there, say you don't have that detail and suggest contacting the landlord. Never invent details."
- When `unknownInfoBehavior = "ignore"`: "Do not answer questions about details not covered in the description above. Redirect the applicant back to the screening questions."

The LLM never has access to information beyond the property description. It cannot hallucinate facts it doesn't have — only fail to admit it doesn't know. The grounding instruction addresses that.
