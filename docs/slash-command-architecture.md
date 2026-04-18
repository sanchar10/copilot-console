# Slash Command & Session Settings Architecture

## Three Session States

Every session is in one of three states. **All** settings operations (mode, model,
compact, agent) must behave consistently across these states.

| State | Description | `isNewSession` | `isSessionReady()` |
|-------|-------------|----------------|---------------------|
| **New** | User clicked "New Session", no message sent yet. No backend session exists. | `true` | `false` |
| **Resumed** | User opened an existing session tab. Backend session record exists but SDK is NOT activated (no CLI subprocess). | `false` | `false` |
| **Active** | At least one message has been sent. SDK session is live (CLI subprocess running). | `false` | `true` |

## Principle: No RPC Until Active

**No SDK/RPC calls happen until the session reaches Active state.**

- **New & Resumed**: Store settings locally → pass with first `sendMessage()`
- **Active**: Fire RPC calls immediately

The backend is the single authority on sequencing. `sendMessage()` handles:
activate session → apply all pending settings (mode, model, compact, agent) → send message.

## Unified Settings Pattern

### Frontend decision tree (ALL settings: mode, model, compact, agent)

```
on setting change:
  if isSessionReady(sessionId):
    → fire API immediately (updateRuntimeSettings / compactSession / etc.)
  else:
    → store locally (session metadata or pending state)
    → applied when first sendMessage() triggers session activation
```

### Current behavior vs. target

| Operation | New Session | Resumed (not active) | Active |
|-----------|-------------|---------------------|--------|
| **Mode** (current) | ✅ Stores in `newSessionSettings` | ❌ Calls `updateRuntimeSettings` eagerly (activates SDK unnecessarily, marks ready) | ✅ Fires immediately |
| **Mode** (target) | ✅ Same | ✅ Store locally, defer to sendMessage | ✅ Same |
| **Model** (current) | ✅ Stores in `newSessionSettings` | ❌ Calls `updateRuntimeSettings` eagerly (activates SDK, does NOT mark ready → user still sees "activating") | ✅ Fires immediately |
| **Model** (target) | ✅ Same | ✅ Store locally (already in session metadata), no backend call | ✅ Same |
| **Compact** (current) | ❌ Calls API, gets 500 error | ❌ Calls API, gets 500 error | ❌ Calls API, gets 500 if nothing to compact |
| **Compact** (target) | ✅ Store `pendingCompact`, defer | ✅ Store `pendingCompact`, defer | ✅ Fire immediately, graceful no-op on error |
| **Agent** (future) | ✅ Store `pendingAgent`, defer | ✅ Store `pendingAgent`, defer | ✅ Fire `rpc.agent.select()` immediately |

### Frontend implementation

**Mode change** (`handleModeChange` in InputBox.tsx):
```typescript
if (isNewSession) {
  updateNewSessionSettings({ agentMode: newMode }); // existing
} else if (isSessionReady(sessionId)) {
  await updateRuntimeSettings(sessionId, { mode: newMode }); // fire RPC
} else {
  // Resumed but not active — store locally, no backend call
  setSessionMode_(newMode);
  setSessionModeStore(sessionId, newMode);
}
```

**Model change** (`handleModelChange` in ChatPane.tsx):
```typescript
updateSessionModel(sessionId, model, reasoningEffort); // always update local
if (isSessionReady(sessionId)) {
  await updateRuntimeSettings(sessionId, { model, reasoning_effort }); // fire RPC
}
// else: local update is enough — sendMessage reads session.model
```

**Compact** (`handleSlashSelect` in useSlashCommands.ts):
```typescript
if (isSessionReady(sessionId)) {
  const result = await compactSession(sessionId); // fire immediately
  showResult(result);
} else {
  // Store pending — will fire on first sendMessage
  store pendingCompact = true;
}
```

**Agent** (future):
```typescript
if (isSessionReady(sessionId)) {
  await selectAgent(sessionId, agentName); // fire immediately
} else {
  store pendingAgent = agentName;
}
```

### Backend `send_message()` — apply all pending settings

After `get_or_create_session()`, before sending the actual message:

```python
# 1. Set mode (existing pattern — line 600-605)
if agent_mode and agent_mode != "interactive":
    await client.set_mode(agent_mode)

# 2. Set model (if changed since session creation)
if model_override:
    await client.set_model(model_override, reasoning_effort)

# 3. Compact (new)
if compact:
    try:
        await client.compact()
    except Exception:
        pass  # graceful no-op

# 4. Select agent (future)
if agent:
    await client.set_agent(agent)

# 5. Send message
await session.send(prompt)
```

### Backend Defense-in-Depth

Even for active sessions where RPC commands fire via standalone endpoints,
the backend must handle errors gracefully. Never 500 on a no-op condition.

```python
# session_client.py — compact()
async def compact(self) -> dict:
    if not self.session:
        return {"success": True, "tokens_removed": 0, "messages_removed": 0}
    try:
        result = await self.session.rpc.history.compact()
        self.touch()
        return {
            "success": result.success,
            "tokens_removed": result.tokens_removed,
            "messages_removed": result.messages_removed,
        }
    except Exception as e:
        logger.debug(f"Compact no-op: {e}")
        return {"success": True, "tokens_removed": 0, "messages_removed": 0}
```

## Command Categories

### Message-Augmented Commands (`/fleet`)

Commands that enhance a user message. They fall through the normal `handleSubmit` flow
with an extra flag on the `sendMessage()` payload. Session state doesn't matter —
`handleSubmit` handles creation/activation automatically.

### Immediate Commands (`/help`)

Pure client-side. No server call. Session state doesn't matter.

### RPC Commands (`/compact`, `/agent`)

Commands requiring SDK RPC. Follow the unified settings pattern above:
active → fire immediately; not active → store and defer.

## sendMessage Payload — Pending Settings

```typescript
// frontend/src/api/sessions.ts
interface SendMessageOptions {
  agent_mode?: string;    // existing — mode to apply after activation
  fleet?: boolean;        // existing — fleet mode flag
  compact?: boolean;      // NEW — compact after activation
  agent?: string;         // FUTURE — agent to select after activation
}
```

```python
# backend sessions.py
class MessageRequest(BaseModel):
    content: str
    is_new_session: bool = False
    mode: str | None = None
    agent_mode: str | None = None
    fleet: bool = False
    compact: bool = False        # NEW
    agent: str | None = None     # FUTURE
```

## Command Registry

| Command | Category | `executeImmediately` | New/Resumed | Active |
|---------|----------|---------------------|-------------|--------|
| `/fleet` | Message-augmented | `false` | handleSubmit auto-handles | handleSubmit auto-handles |
| `/help` | Immediate | `true` | Client-side | Client-side |
| `/compact` | RPC | `true` | Store pending, defer | Fire API immediately |
| `/agent` | RPC (future) | `true` | Store pending, defer | Fire API immediately |

## Non-Slash Settings (same pattern)

| Setting | New | Resumed | Active |
|---------|-----|---------|--------|
| Mode selector | `newSessionSettings.agentMode` | Store locally (no backend call) | `updateRuntimeSettings()` |
| Model picker | `newSessionSettings.model` | `updateSessionModel()` local only | `updateRuntimeSettings()` |
