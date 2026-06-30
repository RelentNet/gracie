-- 0002_add_match_kb_embeddings.sql (P6 — Intelligence Chat & Knowledge Base)
--
-- Adds a NEW similarity-search helper for global Knowledge Base retrieval. The
-- shipped `match_embeddings(query, client_id, count)` filters by `client_id`, so
-- it EXCLUDES Knowledge Base chunks (which are global: `client_id = null`). Rather
-- than weaken that function's client scoping (which would risk leaking one
-- client's chunks into another's chat), KB chunks are retrieved separately by
-- this dedicated function. It returns only chunks whose parent document is
-- AI-active (`knowledge_base_documents.ai_active = true`), so archiving a KB doc
-- immediately removes it from retrieval without deleting its embeddings.
--
-- Depends on the base schema (docs/04-database-schema.sql): the `embeddings`
-- table, the `embedding_source` enum ('knowledge_base'), and
-- `knowledge_base_documents`. Does NOT alter the existing `match_embeddings`.
create or replace function match_kb_embeddings(
  query_embedding vector(1536),
  match_count int default 6
)
returns table (id uuid, source_id uuid, content text, similarity float)
language sql stable as $$
  select e.id, e.source_id, e.content,
         1 - (e.embedding <=> query_embedding) as similarity
  from embeddings e
  join knowledge_base_documents k on k.id = e.source_id
  where e.source_type = 'knowledge_base'
    and k.ai_active = true
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
