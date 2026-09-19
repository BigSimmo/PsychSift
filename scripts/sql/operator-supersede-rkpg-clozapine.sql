-- ============================================================================
-- Operator script: Supersede Rockingham Peel clozapine guideline (#7VQ5RC)
--
-- Clinical decision: 2026-09-19 by Dr Josh, Consultant Psychiatrist.
-- Clozapine Therapy - Initiation, Continuation and Ceasing Policy and Procedure (RKPG).pdf
-- states WBC < 1.5 x 10^9/L for neutropenia and WBC < 0.5 for agranulocytosis on p16,
-- which are ANC figures. Standard Australian practice pairs WBC red threshold with 3.0.
--
-- To prevent contradictory clinical evidence from entering search answers, this script
-- sets the document status to 'superseded', excluding it from candidate generation
-- (match_governed_candidate_chunks_v3 requires status = 'indexed').
-- Retrieval cleanly falls back to sibling WA guidelines:
-- - Clozapine Prescribing (NMHS)
-- - Clozapine Prescribing, Administration and Monitoring (AKG)
-- - Clozapine Therapy - Initiation and Continuation (FSH)
-- ============================================================================

begin;

update public.documents
set status = 'superseded',
    metadata = metadata || jsonb_build_object(
      'document_status', 'superseded',
      'change_state', 'superseded',
      'superseded_at', now(),
      'superseded_by_clinical_governance', 'Dr Josh, Consultant Psychiatrist',
      'clinical_governance_notes', 'Superseded due to contradictory WBC/ANC threshold labels on p16 per issue #7VQ5RC; search relies on NMHS, AKG, and FSH guidelines'
    ),
    updated_at = now()
where file_name = 'Clozapine Therapy - Initiation, Continuation and Ceasing Policy and Procedure (RKPG).pdf'
   or id = '9324f2e2-6d37-43cf-aea3-8f451b6ee980';

commit;
