-- ============================================================
-- Migration 043 — Performance indexes for 50k-user scale.
--
-- Every index uses CONCURRENTLY so it can be applied to a live
-- production database without locking writes. On a cold local
-- instance (supabase db reset) CONCURRENTLY is a no-op — the
-- DB has no live readers so the build is instant either way.
--
-- Each block targets a specific high-traffic hot path identified
-- by query analysis:
--   • conversations inbox list      (account + status ordered by updated_at)
--   • automation dispatch           (account + trigger_type, active-only)
--   • automation cron drain         (pending executions by run_at)
--   • message pagination            (per conversation ordered by created_at)
--   • contacts search               (phone, name prefix)
--   • broadcast recipient status    (status webhook fan-out)
--   • API key auth                  (hash lookup, non-revoked)
--   • notification feed             (account ordered by created_at)
-- ============================================================

-- ----------------------------------------------------------------
-- conversations — inbox list (most-used query in the product)
-- Covers:  WHERE account_id = $1 AND status = $2
--          ORDER BY updated_at DESC
-- Without this, every inbox load is a seqscan over all account rows.
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_account_status_updated
  ON conversations (account_id, status, updated_at DESC);

-- Assigned-agent filter (agent inbox view)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_account_agent
  ON conversations (account_id, assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL;

-- ----------------------------------------------------------------
-- automations — dispatch lookup
-- Covers:  WHERE account_id = $1
--            AND trigger_type = $2
--            AND is_active = true
-- Fires on every inbound WhatsApp message. Must be index-only.
-- Partial index on is_active keeps the index tiny — inactive rows
-- never appear in the dispatch path.
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_automations_account_trigger_active
  ON automations (account_id, trigger_type)
  WHERE is_active = true;

-- ----------------------------------------------------------------
-- automation_pending_executions — cron drain
-- Covers:  WHERE status = 'pending'
--            AND run_at <= NOW()
--          ORDER BY run_at
-- Partial index on status = 'pending' keeps it small; 'done' and
-- 'failed' rows accumulate but never appear in the drain query.
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_exec_run_at_pending
  ON automation_pending_executions (run_at)
  WHERE status = 'pending';

-- ----------------------------------------------------------------
-- messages — paginated conversation thread
-- Covers:  WHERE conversation_id = $1
--          ORDER BY created_at DESC
--          LIMIT n
-- Inbox renders the last N messages on open; this makes it O(1).
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conv_created_desc
  ON messages (conversation_id, created_at DESC);

-- Outbound message status updates (webhook DELIVERED / READ)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_message_id_lookup
  ON messages (message_id)
  WHERE message_id IS NOT NULL;

-- ----------------------------------------------------------------
-- contacts — search by phone and name
-- Phone is exact-match: the existing idx_contacts_phone on user_id
-- from migration 001 predates account_id (added in 017). The new
-- index covers the post-017 shape used everywhere in production.
-- Name uses text_pattern_ops for LIKE 'prefix%' searches.
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_account_phone
  ON contacts (account_id, phone)
  WHERE account_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_account_name_prefix
  ON contacts (account_id, name text_pattern_ops)
  WHERE account_id IS NOT NULL;

-- ----------------------------------------------------------------
-- broadcast_recipients — status webhook fan-out
-- Covers:  WHERE broadcast_id = $1 AND status = $2
-- The inbound webhook updates individual recipient rows when Meta
-- sends DELIVERED / READ / FAILED. Without this, each update is
-- a seqscan over all recipients of a broadcast.
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_broadcast_recipients_broadcast_status
  ON broadcast_recipients (broadcast_id, status);

-- wamid lookup (webhook delivery status path — most frequent hit)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_broadcast_recipients_wamid
  ON broadcast_recipients (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- ----------------------------------------------------------------
-- api_keys — hash lookup
-- Covers:  WHERE key_hash = $1 AND revoked_at IS NULL
-- Every /api/v1/* request authenticates via this lookup. Partial
-- index excludes revoked keys, keeping the hot read path tiny.
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_hash_active
  ON api_keys (key_hash)
  WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------
-- notifications — per-account feed
-- Covers:  WHERE account_id = $1
--          ORDER BY created_at DESC
--          LIMIT n
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_account_created
  ON notifications (account_id, created_at DESC);

-- Unread filter (badge count)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_account_unread
  ON notifications (account_id)
  WHERE read_at IS NULL;

-- ----------------------------------------------------------------
-- automation_logs — per-account history view
-- Covers:  WHERE account_id = $1
--          ORDER BY created_at DESC
-- ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_automation_logs_account_created
  ON automation_logs (account_id, created_at DESC);
