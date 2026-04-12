/**
 * Type-level characterization test for ChatStep.
 *
 * This file doesn't run at runtime — it's checked by `tsc`. If Fenster's
 * deduplication changes the shape of ChatStep, this file will produce
 * compilation errors, catching the breakage at build time.
 *
 * ChatStep is currently defined in:
 *   - types/message.ts
 *   - types/session.ts
 *   - stores/chatStore.ts
 * All three must remain structurally compatible.
 */
import type { ChatStep as ChatStepFromMessage } from './message';
import type { ChatStep as ChatStepFromSession } from './session';
import type { ChatStep as ChatStepFromStore } from '../stores/chatStore';

// --- Shape assertions: ChatStep must have these exact fields ---

type AssertExtends<T, U> = T extends U ? true : never;
type AssertEquals<T, U> = [T] extends [U] ? ([U] extends [T] ? true : never) : never;

// Required field: title (string)
const _titleRequired1: AssertExtends<ChatStepFromMessage, { title: string }> = true;
const _titleRequired2: AssertExtends<ChatStepFromSession, { title: string }> = true;
const _titleRequired3: AssertExtends<ChatStepFromStore, { title: string }> = true;

// Optional field: detail (string | undefined)
const _detailOptional1: AssertExtends<ChatStepFromMessage, { detail?: string }> = true;
const _detailOptional2: AssertExtends<ChatStepFromSession, { detail?: string }> = true;
const _detailOptional3: AssertExtends<ChatStepFromStore, { detail?: string }> = true;

// All three definitions must be structurally identical
const _messageEqualsSession: AssertEquals<ChatStepFromMessage, ChatStepFromSession> = true;
const _sessionEqualsStore: AssertEquals<ChatStepFromSession, ChatStepFromStore> = true;
const _storeEqualsMessage: AssertEquals<ChatStepFromStore, ChatStepFromMessage> = true;

// Prevent unused variable warnings
void _titleRequired1; void _titleRequired2; void _titleRequired3;
void _detailOptional1; void _detailOptional2; void _detailOptional3;
void _messageEqualsSession; void _sessionEqualsStore; void _storeEqualsMessage;
