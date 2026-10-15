-- Tighten three owner policies so a doctor can only attach rows to a document they own.
--
-- The two-user privacy test (tests/sql/two-user-privacy.sql) found that these policies check
-- the row's own owner_id but not the owner of the parent document, so a signed-in doctor could
-- attach a manual label, section or memory card of their own to another doctor's document.
-- Browser roles hold no grant on these tables and the server routes check document ownership
-- before writing, so this was unreachable. This closes it at the database too.
--
-- Only WITH CHECK changes: what a doctor can read or delete is unchanged. The server's service
-- role bypasses row-level security, so app behaviour is unchanged.

set local lock_timeout = '10s';
set local statement_timeout = '30s';

alter policy "labels owner manual insert" on public.document_labels
  with check (
    (select auth.uid()) = owner_id and source = 'manual'
    and exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()))
  );

alter policy "labels owner manual update" on public.document_labels
  with check (
    (select auth.uid()) = owner_id and source = 'manual'
    and exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()))
  );

alter policy "document sections owner all" on public.document_sections
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()))
  );

alter policy "document memory cards owner all" on public.document_memory_cards
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()))
  );
