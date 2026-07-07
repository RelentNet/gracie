-- 0006_add_match_all_embeddings.sql (P6B.1 — Company-aware Assistant)
--
-- Cross-client similarity search for the company-aware Assistant. The shipped
-- `match_embeddings(query, client_id, count)` REQUIRES a client id (a null id has
-- no predicate and would match every client's chunks), and `match_kb_embeddings`
-- covers only the global Knowledge Base. Neither serves a company-wide assistant
-- that must retrieve across ALL clients and then gate the results per the ASKING
-- user's role in the application layer.
--
-- This function returns the SAME shape as `match_embeddings` PLUS `client_id` (so
-- the caller can label/scope each chunk) across every client-scoped embedding.
-- Knowledge Base chunks are EXCLUDED (`source_type <> 'knowledge_base'`, which for
-- KB is equivalently `client_id is null`) because they are retrieved separately by
-- `match_kb_embeddings` (global, `ai_active` only).
--
-- SECURITY: this RPC performs NO role filtering. It is deliberately permissive and
-- is meant to OVER-FETCH a candidate pool. The caller (apps/web company retrieval)
-- MUST apply the role gates — `filterChunksForRole` (drops transcripts for
-- non-admins) and the restricted-folder-visibility gate — and trim to top-K BEFORE
-- any chunk reaches a user. Read-only; STABLE; does NOT alter existing functions.
-- Mirrors the style of `match_embeddings` / `match_kb_embeddings` (docs/04 §RPC).
create or replace function match_all_embeddings(
  query_embedding vector(1536),
  match_count int default 24
)
returns table (
  id uuid,
  source_type embedding_source,
  source_id uuid,
  client_id uuid,
  content text,
  similarity float
)
language sql stable as $$
  select e.id, e.source_type, e.source_id, e.client_id, e.content,
         1 - (e.embedding <=> query_embedding) as similarity
  from embeddings e
  where e.source_type <> 'knowledge_base'
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
