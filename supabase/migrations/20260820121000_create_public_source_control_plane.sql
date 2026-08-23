-- Source-only control plane for governed Australian public-source acquisition.
-- Applying this migration and operating the provider workflows are separate approvals.

CREATE TABLE public.public_source_activation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_catalogue_key text NOT NULL CHECK (btrim(source_catalogue_key) <> ''),
  source_policy_version text NOT NULL CHECK (btrim(source_policy_version) <> ''),
  source_policy_digest text NOT NULL CHECK (source_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  decision text NOT NULL CHECK (decision IN ('activate', 'quarantine', 'retire')),
  operator_id uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 1000),
  evidence_references text[] NOT NULL CHECK (
    cardinality(evidence_references) BETWEEN 1 AND 50
    AND array_position(evidence_references, '') IS NULL
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX public_source_activation_events_source_created_idx
  ON public.public_source_activation_events (source_catalogue_key, created_at DESC, id DESC);

CREATE TABLE public.public_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_catalogue_key text NOT NULL CHECK (btrim(source_catalogue_key) <> ''),
  source_policy_version text NOT NULL CHECK (btrim(source_policy_version) <> ''),
  source_policy_digest text NOT NULL CHECK (source_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  exact_canonical_url text NOT NULL CHECK (exact_canonical_url ~ '^https://'),
  exact_version_url text NOT NULL CHECK (exact_version_url ~ '^https://'),
  exact_version text NOT NULL CHECK (btrim(exact_version) <> ''),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  retrieved_at timestamptz NOT NULL,
  licence_evidence_digest text NOT NULL CHECK (licence_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  staging_document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  extraction_generation_id uuid,
  index_generation_id uuid,
  lifecycle text NOT NULL CHECK (lifecycle IN ('discovered', 'shadow', 'approved', 'active', 'quarantined', 'tombstoned')),
  supersedes_version_id uuid REFERENCES public.public_source_versions(id) ON DELETE RESTRICT,
  activation_event_id uuid NOT NULL REFERENCES public.public_source_activation_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_catalogue_key, exact_version_url, content_hash),
  CHECK (supersedes_version_id IS NULL OR supersedes_version_id <> id)
);

CREATE INDEX public_source_versions_source_lifecycle_idx
  ON public.public_source_versions (source_catalogue_key, lifecycle, retrieved_at DESC, id DESC);
CREATE INDEX public_source_versions_staging_document_idx
  ON public.public_source_versions (staging_document_id);

ALTER TABLE public.public_source_activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_source_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.public_source_activation_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.public_source_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_source_activation_events TO service_role;
GRANT SELECT ON TABLE public.public_source_versions TO service_role;

CREATE OR REPLACE FUNCTION public.reject_public_source_activation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'public_source_activation_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS public_source_activation_events_immutable
  ON public.public_source_activation_events;
CREATE TRIGGER public_source_activation_events_immutable
BEFORE UPDATE OR DELETE ON public.public_source_activation_events
FOR EACH ROW EXECUTE FUNCTION public.reject_public_source_activation_event_mutation();

CREATE OR REPLACE FUNCTION public.record_public_source_activation_event(p_manifest jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_catalogue_key text := btrim(coalesce(p_manifest->>'catalogueKey', ''));
  v_policy_version text := btrim(coalesce(p_manifest->>'sourcePolicyVersion', ''));
  v_policy_digest text := btrim(coalesce(p_manifest->>'sourcePolicyDigest', ''));
  v_decision text := btrim(coalesce(p_manifest->>'decision', ''));
  v_operator_id uuid;
  v_reason text := btrim(coalesce(p_manifest->>'reason', ''));
  v_evidence text[];
BEGIN
  IF coalesce(p_manifest->>'version', '') <> '1'
     OR v_catalogue_key = ''
     OR v_policy_version = ''
     OR v_policy_digest !~ '^sha256:[0-9a-f]{64}$'
     OR v_decision NOT IN ('activate', 'quarantine', 'retire')
     OR v_reason = ''
     OR length(v_reason) > 1000
  THEN
    RAISE EXCEPTION 'Invalid public source activation manifest';
  END IF;
  IF v_policy_version <> 'australian-source-policy-v1'
     OR v_policy_digest <> 'sha256:02dcc095258338d0c355af79dfa1889c024f25f385b553e5b6c802207546855d'
  THEN
    RAISE EXCEPTION 'Public source activation policy is not the reviewed catalogue';
  END IF;
  IF v_decision = 'activate'
     AND v_catalogue_key NOT IN (
       'wa-health',
       'wa-chief-psychiatrist',
       'wa-legislation',
       'tga',
       'acsqhc',
       'australian-health-disability-ageing',
       'nhmrc',
       'ranzcp',
       'racgp',
       'pbs',
       'australian-prescriber',
       'nsw-health',
       'queensland-health',
       'sa-health',
       'victoria-health',
       'tasmania-health',
       'nt-health',
       'act-health'
     )
  THEN
    RAISE EXCEPTION 'Public source is excluded, link-only, historical, or unknown';
  END IF;

  BEGIN
    v_operator_id := (p_manifest->>'operatorId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid public source activation operator';
  END;

  SELECT array_agg(value ORDER BY ordinal)
  INTO v_evidence
  FROM jsonb_array_elements_text(coalesce(p_manifest->'evidenceReferences', '[]'::jsonb))
    WITH ORDINALITY evidence(value, ordinal);
  IF cardinality(v_evidence) NOT BETWEEN 1 AND 50
     OR EXISTS (SELECT 1 FROM unnest(v_evidence) value WHERE btrim(value) = '')
     OR cardinality(v_evidence) <> (SELECT count(DISTINCT value) FROM unnest(v_evidence) value)
  THEN
    RAISE EXCEPTION 'Invalid public source activation evidence';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_catalogue_key, 0));
  PERFORM 1
  FROM public.public_source_activation_events
  WHERE source_catalogue_key = v_catalogue_key
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO public.public_source_activation_events (
    source_catalogue_key,
    source_policy_version,
    source_policy_digest,
    decision,
    operator_id,
    reason,
    evidence_references
  ) VALUES (
    v_catalogue_key,
    v_policy_version,
    v_policy_digest,
    v_decision,
    v_operator_id,
    v_reason,
    v_evidence
  )
  RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_public_source_fetch_manifest(
  p_source_catalogue_key text,
  p_source_policy_version text,
  p_source_policy_digest text,
  p_activation_event_id uuid,
  p_exact_url text,
  p_exact_version text,
  p_licence_evidence_digest text,
  p_staging_owner_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.public_source_activation_events%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_catalogue_key, 0));
  SELECT * INTO v_event
  FROM public.public_source_activation_events
  WHERE source_catalogue_key = p_source_catalogue_key
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_event.id IS DISTINCT FROM p_activation_event_id OR v_event.decision <> 'activate' THEN
    RAISE EXCEPTION 'Only an active source definition may create a fetch manifest';
  END IF;
  IF v_event.source_policy_version IS DISTINCT FROM p_source_policy_version
     OR v_event.source_policy_digest IS DISTINCT FROM p_source_policy_digest
  THEN
    RAISE EXCEPTION 'Public source fetch manifest policy does not match activation evidence';
  END IF;
  IF p_exact_url !~ '^https://'
     OR btrim(coalesce(p_exact_version, '')) = ''
     OR p_licence_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
     OR p_staging_owner_id IS NULL
  THEN
    RAISE EXCEPTION 'Public source fetch manifest requires exact version, licence, and owner evidence';
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 'public-source-acquisition-v1',
    'sourcePolicyVersion', p_source_policy_version,
    'sourcePolicyDigest', p_source_policy_digest,
    'sourceActivationEventId', p_activation_event_id,
    'catalogueKey', p_source_catalogue_key,
    'exactUrl', p_exact_url,
    'exactVersion', p_exact_version,
    'licenceEvidenceDigest', p_licence_evidence_digest,
    'stagingOwnerId', p_staging_owner_id,
    'targetLifecycle', 'shadow'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_public_source_version(p_version jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version_id uuid;
  v_document_id uuid;
  v_owner_id uuid;
  v_activation_event_id uuid;
  v_document public.documents%ROWTYPE;
  v_event public.public_source_activation_events%ROWTYPE;
BEGIN
  BEGIN
    v_document_id := (p_version->>'stagingDocumentId')::uuid;
    v_owner_id := (p_version->>'stagingOwnerId')::uuid;
    v_activation_event_id := (p_version->>'activationEventId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid public source staging identity';
  END;

  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(p_version->>'catalogueKey', ''), 0));
  SELECT * INTO v_event
  FROM public.public_source_activation_events
  WHERE source_catalogue_key = p_version->>'catalogueKey'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR v_event.id IS DISTINCT FROM v_activation_event_id OR v_event.decision <> 'activate' THEN
    RAISE EXCEPTION 'Public source staging requires an active source definition';
  END IF;

  SELECT * INTO v_document
  FROM public.documents
  WHERE id = v_document_id
  FOR UPDATE;
  IF NOT FOUND OR v_document.owner_id IS NULL OR v_document.owner_id IS DISTINCT FROM v_owner_id THEN
    RAISE EXCEPTION 'Public source staging document must retain its exact owner';
  END IF;
  IF coalesce(p_version->>'lifecycle', '') <> 'shadow'
     OR coalesce(v_document.metadata->>'public_source_lifecycle', '') <> 'shadow'
     OR v_document.metadata->>'source_catalogue_key' IS DISTINCT FROM p_version->>'catalogueKey'
     OR v_document.metadata->>'source_policy_version' IS DISTINCT FROM v_event.source_policy_version
     OR v_document.metadata->>'source_policy_digest' IS DISTINCT FROM v_event.source_policy_digest
     OR v_document.metadata->>'content_mode' IS DISTINCT FROM 'indexed_content'
     OR v_document.metadata->>'licence_policy' IS DISTINCT FROM 'public_index_permitted'
  THEN
    RAISE EXCEPTION 'Public source staging policy or lifecycle mismatch';
  END IF;

  INSERT INTO public.public_source_versions (
    source_catalogue_key,
    source_policy_version,
    source_policy_digest,
    exact_canonical_url,
    exact_version_url,
    exact_version,
    content_hash,
    retrieved_at,
    licence_evidence_digest,
    staging_document_id,
    lifecycle,
    supersedes_version_id,
    activation_event_id
  ) VALUES (
    p_version->>'catalogueKey',
    v_event.source_policy_version,
    v_event.source_policy_digest,
    p_version->>'exactCanonicalUrl',
    p_version->>'exactUrl',
    p_version->>'exactVersion',
    p_version->>'contentHash',
    coalesce((p_version->>'retrievedAt')::timestamptz, now()),
    p_version->>'licenceEvidenceDigest',
    v_document_id,
    'shadow',
    NULL,
    v_activation_event_id
  )
  RETURNING id INTO v_version_id;
  RETURN v_version_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_public_source_version(
  p_version_id uuid,
  p_expected_lifecycle text,
  p_new_lifecycle text,
  p_activation_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version public.public_source_versions%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_event public.public_source_activation_events%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  SELECT * INTO v_version
  FROM public.public_source_versions
  WHERE id = p_version_id
  FOR UPDATE;
  IF NOT FOUND OR v_version.lifecycle IS DISTINCT FROM p_expected_lifecycle THEN
    RAISE EXCEPTION 'Public source version changed after review';
  END IF;

  SELECT * INTO v_document
  FROM public.documents
  WHERE id = v_version.staging_document_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public source staging document is missing'; END IF;

  v_allowed := CASE v_version.lifecycle
    WHEN 'discovered' THEN p_new_lifecycle IN ('shadow', 'quarantined', 'tombstoned')
    WHEN 'shadow' THEN p_new_lifecycle IN ('approved', 'quarantined', 'tombstoned')
    WHEN 'approved' THEN p_new_lifecycle IN ('active', 'quarantined', 'tombstoned')
    WHEN 'active' THEN p_new_lifecycle IN ('quarantined', 'tombstoned')
    WHEN 'quarantined' THEN p_new_lifecycle = 'tombstoned'
    ELSE false
  END;
  IF NOT v_allowed THEN RAISE EXCEPTION 'Invalid public source lifecycle transition'; END IF;

  IF p_new_lifecycle = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_version.source_catalogue_key, 0));
    SELECT * INTO v_event
    FROM public.public_source_activation_events
    WHERE source_catalogue_key = v_version.source_catalogue_key
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND OR v_event.id IS DISTINCT FROM p_activation_event_id OR v_event.decision <> 'activate'
       OR v_event.source_policy_version IS DISTINCT FROM v_version.source_policy_version
       OR v_event.source_policy_digest IS DISTINCT FROM v_version.source_policy_digest
    THEN
      RAISE EXCEPTION 'Exact document publication approval is distinct from source activation; both are required';
    END IF;
    IF v_document.owner_id IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.document_publication_approvals approval
         WHERE approval.document_id = v_document.id
           AND approval.decision = 'approved'
           AND approval.source_catalogue_key = v_version.source_catalogue_key
           AND approval.source_policy_version = v_version.source_policy_version
       )
    THEN
      RAISE EXCEPTION 'Exact document publication approval is distinct from source activation; both are required';
    END IF;
  END IF;

  UPDATE public.public_source_versions
  SET lifecycle = p_new_lifecycle,
      activation_event_id = coalesce(p_activation_event_id, activation_event_id),
      updated_at = now()
  WHERE id = p_version_id;

  RETURN jsonb_build_object('versionId', p_version_id, 'lifecycle', p_new_lifecycle);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_public_source_activation_event_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_public_source_activation_event(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_public_source_fetch_manifest(text, text, text, uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage_public_source_version(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_public_source_version(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_public_source_activation_event(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_public_source_fetch_manifest(text, text, text, uuid, text, text, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_public_source_version(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_public_source_version(uuid, text, text, uuid) TO service_role;
