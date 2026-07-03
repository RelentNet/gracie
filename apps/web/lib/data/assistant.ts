/**
 * Assistant data access (P6B, docs/05 §Assistant). The single place every
 * Assistant route reads/writes `assistant_chats` / `assistant_messages` /
 * `assistant_attachments`.
 *
 * SECURITY GATE: the app uses the service-role Supabase client, which BYPASSES
 * RLS — so every function here enforces `user_id = <owner>` (or ownership via the
 * parent chat) in its OWN query logic. `ownerId` is always a resolved `users.id`
 * (see lib/assistant/user.ts), never a client-supplied value. There is NO admin
 * read path: admins can only purge (delete-only) via {@link purgeUserAssistantData}.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database, Json } from '@gracie/db';

type ChatRow = Database['public']['Tables']['assistant_chats']['Row'];
type MessageRow = Database['public']['Tables']['assistant_messages']['Row'];
type AttachmentRow = Database['public']['Tables']['assistant_attachments']['Row'];

/** Sidebar/list view of a conversation. */
export interface AssistantChatView {
  readonly id: string;
  readonly title: string | null;
  readonly model: string | null;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A single persisted message. */
export interface AssistantMessageView {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly attachmentIds: readonly string[];
  readonly createdAt: string;
}

/** Chat-scoped attachment (metadata only — extracted text is never returned to the client). */
export interface AssistantAttachmentView {
  readonly id: string;
  readonly fileName: string;
  readonly createdAt: string;
}

/** Estimated token accounting persisted per assistant message (feeds P9/P10). */
export interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
  /** True while streaming can't report exact counts — a char-based estimate. */
  readonly estimated: boolean;
}

function toChatView(row: ChatRow): AssistantChatView {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessageView(row: MessageRow): AssistantMessageView {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachmentIds: row.attachment_ids,
    createdAt: row.created_at,
  };
}

/** Escape LIKE metacharacters so a search term is matched literally. */
function escapeLike(term: string): string {
  return term.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * List a user's conversations, most-recent first. Non-archived by default; an
 * optional `search` filters by title (case-insensitive substring).
 */
export async function listChats(
  ownerId: string,
  options: { readonly search?: string; readonly includeArchived?: boolean } = {},
): Promise<AssistantChatView[]> {
  const db = getServerClient();
  let query = db
    .from('assistant_chats')
    .select('*')
    .eq('user_id', ownerId)
    .order('updated_at', { ascending: false });

  if (options.includeArchived !== true) query = query.eq('archived', false);
  const search = options.search?.trim();
  if (search !== undefined && search !== '') query = query.ilike('title', `%${escapeLike(search)}%`);

  const { data, error } = await query;
  if (error !== null) throw new Error(`listChats: ${error.message}`);
  return (data ?? []).map(toChatView);
}

/** Create a new conversation owned by `ownerId`, pinned to `model`. */
export async function createChat(ownerId: string, model: string): Promise<AssistantChatView> {
  const db = getServerClient();
  const { data, error } = await db
    .from('assistant_chats')
    .insert({ user_id: ownerId, model })
    .select('*')
    .single();
  if (error !== null) throw new Error(`createChat: ${error.message}`);
  return toChatView(data);
}

/** Fetch one conversation IFF it belongs to `ownerId`; `null` otherwise. */
export async function getChat(ownerId: string, chatId: string): Promise<AssistantChatView | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('assistant_chats')
    .select('*')
    .eq('id', chatId)
    .eq('user_id', ownerId)
    .maybeSingle();
  if (error !== null) throw new Error(`getChat: ${error.message}`);
  return data === null ? null : toChatView(data);
}

/**
 * Load a conversation and its ordered messages, ownership-checked. Returns `null`
 * when the chat does not exist or is not owned by `ownerId` (indistinguishable on
 * purpose — a non-owner learns nothing about another user's chats).
 */
export async function getChatWithMessages(
  ownerId: string,
  chatId: string,
): Promise<{ readonly chat: AssistantChatView; readonly messages: AssistantMessageView[] } | null> {
  const chat = await getChat(ownerId, chatId);
  if (chat === null) return null;

  const db = getServerClient();
  const { data, error } = await db
    .from('assistant_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });
  if (error !== null) throw new Error(`getChatWithMessages: ${error.message}`);
  return { chat, messages: (data ?? []).map(toMessageView) };
}

/** Rename / archive a conversation, ownership-checked. `null` if not owned. */
export async function updateChat(
  ownerId: string,
  chatId: string,
  patch: { readonly title?: string; readonly archived?: boolean },
): Promise<AssistantChatView | null> {
  const db = getServerClient();
  const update: Database['public']['Tables']['assistant_chats']['Update'] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.archived !== undefined) update.archived = patch.archived;

  const { data, error } = await db
    .from('assistant_chats')
    .update(update)
    .eq('id', chatId)
    .eq('user_id', ownerId)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`updateChat: ${error.message}`);
  return data === null ? null : toChatView(data);
}

/** Delete a conversation (cascades messages + attachments), ownership-checked. */
export async function deleteChat(ownerId: string, chatId: string): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db
    .from('assistant_chats')
    .delete()
    .eq('id', chatId)
    .eq('user_id', ownerId)
    .select('id');
  if (error !== null) throw new Error(`deleteChat: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Append a message to a chat. Callers MUST verify chat ownership beforehand. */
export async function insertMessage(params: {
  readonly chatId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly attachmentIds?: readonly string[];
  readonly tokenUsage?: TokenUsage;
}): Promise<void> {
  const db = getServerClient();
  const { error } = await db.from('assistant_messages').insert({
    chat_id: params.chatId,
    role: params.role,
    content: params.content,
    attachment_ids: params.attachmentIds !== undefined ? [...params.attachmentIds] : [],
    token_usage: params.tokenUsage !== undefined ? (params.tokenUsage as unknown as Json) : null,
  });
  if (error !== null) throw new Error(`insertMessage: ${error.message}`);
}

/**
 * Read extracted text for the given attachment ids, ownership + chat-scope
 * checked: only rows where `user_id = owner` AND `chat_id = chatId` are returned,
 * so a user can never inject another user's (or another chat's) file into context.
 */
export async function getAttachmentsForContext(
  ownerId: string,
  chatId: string,
  attachmentIds: readonly string[],
): Promise<Array<{ readonly fileName: string; readonly extractedText: string }>> {
  if (attachmentIds.length === 0) return [];
  const db = getServerClient();
  const { data, error } = await db
    .from('assistant_attachments')
    .select('file_name, extracted_text')
    .eq('user_id', ownerId)
    .eq('chat_id', chatId)
    .in('id', [...attachmentIds]);
  if (error !== null) throw new Error(`getAttachmentsForContext: ${error.message}`);
  return (data ?? [])
    .filter((row): row is { file_name: string; extracted_text: string } => row.extracted_text !== null && row.extracted_text !== '')
    .map((row) => ({ fileName: row.file_name, extractedText: row.extracted_text }));
}

/** Persist an extracted, chat-scoped attachment. Chat ownership pre-verified. */
export async function insertAttachment(params: {
  readonly ownerId: string;
  readonly chatId: string;
  readonly fileName: string;
  readonly extractedText: string;
  readonly r2Key: string | null;
}): Promise<AssistantAttachmentView> {
  const db = getServerClient();
  const { data, error } = await db
    .from('assistant_attachments')
    .insert({
      user_id: params.ownerId,
      chat_id: params.chatId,
      file_name: params.fileName,
      extracted_text: params.extractedText,
      r2_key: params.r2Key,
    })
    .select('id, file_name, created_at')
    .single();
  if (error !== null) throw new Error(`insertAttachment: ${error.message}`);
  return { id: data.id, fileName: data.file_name, createdAt: data.created_at };
}

/** Raw MinIO keys retained for a user's attachments (for best-effort object cleanup). */
export async function listUserAttachmentKeys(targetUserId: string): Promise<string[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('assistant_attachments')
    .select('r2_key')
    .eq('user_id', targetUserId);
  if (error !== null) throw new Error(`listUserAttachmentKeys: ${error.message}`);
  return (data ?? [])
    .map((row: Pick<AttachmentRow, 'r2_key'>) => row.r2_key)
    .filter((key): key is string => key !== null && key !== '');
}

/**
 * Admin offboarding purge (delete-only — NEVER selects content). Deletes every
 * conversation owned by `targetUserId` (cascades messages + attachments) and sets
 * `users.deactivated_at`. Returns the number of chats removed.
 */
export async function purgeUserAssistantData(targetUserId: string): Promise<{ readonly chatsDeleted: number }> {
  const db = getServerClient();
  const { data, error } = await db
    .from('assistant_chats')
    .delete()
    .eq('user_id', targetUserId)
    .select('id');
  if (error !== null) throw new Error(`purgeUserAssistantData: ${error.message}`);

  const { error: deactivateError } = await db
    .from('users')
    .update({ deactivated_at: new Date().toISOString() })
    .eq('id', targetUserId);
  if (deactivateError !== null) throw new Error(`purgeUserAssistantData(deactivate): ${deactivateError.message}`);

  return { chatsDeleted: (data ?? []).length };
}
