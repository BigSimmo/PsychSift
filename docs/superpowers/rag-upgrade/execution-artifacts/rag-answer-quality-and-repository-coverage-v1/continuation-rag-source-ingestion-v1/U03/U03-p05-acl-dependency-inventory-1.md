# U03 P05 ACL dependency inventory 1

Preparation for independent amendment review; **not acceptance or SQL/runtime proof**. Inspected only immutable Git objects at TASK_BASE `8c11f138e6c683a13db3b465332e7f3cbb515c62` in `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`, plus the controller's outside `U03-frozen-p05-prerequisite-comparison-1.md`, especially D3. No moving product content, protected `1/`, unrelated untracked files, tests, SQL, network, providers, workers, commits or repository writes were used. This report is the sole write.

## Answer

No existing named source caller in the requested `src`, `scripts`, or `supabase/functions` scope directly mutates the three selected tables. The sole direct table access is a SELECT of `public_source_versions`. Keeping that SELECT and the eight explicitly granted service-role entrypoints below therefore has **no identified source-level compatibility break**. Selected internal helper calls occur inside SQL functions/triggers, not application RPC calls. Their enclosing privileged entrypoints are SECURITY DEFINER; removing the caller role's direct EXECUTE on those helpers does not remove the defining owner's privileges.

This conclusion assumes the expected privileged migration/definition owner, conventionally postgres. The inspected P05 migrations contain no explicit OWNER TO or SET ROLE for these objects; actual installed owners, role membership/inheritance, grants from other grantors and effective privileges were not observed. Do not claim an executed least-privilege or owner-identity verdict from this inventory. Direct external/manual integrations outside the inspected source trees are also unproven.

D3 needs a precision correction: the encoded postgres defaults grant **SELECT, INSERT, UPDATE, DELETE**, not TRUNCATE, REFERENCES or TRIGGER. An explicit revocation of all six non-SELECT privileges is a defensible exact intended end-state, but this source evidence only establishes inherited INSERT/UPDATE/DELETE among those six. Do not describe all six as proven inherited privileges.

## Source call inventory

All paths and line numbers below are immutable TASK_BASE references, not current working files. Generated database types are declarations, not runtime consumers.

| Consumer | Exact operation | Disposition |
| --- | --- | --- |
| `scripts/fetch-approved-public-source-versions.ts:198–203` | `.from("public_source_versions").select("id").eq(...).maybeSingle()` | Sole direct selected-table access; SELECT retained. Admin client created at 162–167. |
| Same script 173–182 | RPC `create_public_source_fetch_manifest` with eight named arguments | Retain service-role EXECUTE. |
| Same script 226–228 and 269–275 | RPC `stage_public_source_version`, argument `p_version` | Retain service-role EXECUTE; both resume and new-stage call sites. |
| `scripts/check-public-source-changes.ts:72–81` | RPC `record_unchanged_public_source_check`, argument `p_check` | Retain service-role EXECUTE. Admin client created at 66–70. |
| Same script 88–95 | RPC `tombstone_public_source_version_for_review`, six named arguments | Retain service-role EXECUTE. |
| `src/lib/rag/rag-cache.ts:638,689` | RPC `public_source_serving_authority_stamp()` through admin client | Retain service-role EXECUTE; this read API is not the internal mutating bump helper. |
| `src/lib/supabase/database.types.ts:1171–1340,3482–3525` | Table/function type declarations | No mutation or RPC invocation. The eligibility predicate declaration does not prove a direct consumer. |

No runtime source call was found for `record_public_source_activation_event`, `activate_public_source_version`, or the six-argument `transition_public_source_version` in the inspected trees. **Their existing explicit entrypoint grants must still be retained**: absence of a current source caller is not authority to retire a governed operator interface. No source caller was found for the internal helpers listed below. No direct selected-table reference was found in `supabase/functions`.

The fetch script also mutates documents/Storage, but those are different resources outside this ACL change and were not assessed or altered. The named SQL prerequisite helpers required by the moving U03 implementation were deliberately not inspected; the controller must check that candidate against this immutable inventory after freeze.

## Exact retained service-role entrypoints

Use public-qualified signatures; all eight effective definitions are SECURITY DEFINER with empty search_path. This table records the final explicit `GRANT EXECUTE ON FUNCTION public.<signature> TO service_role` owner in the migration chain, not permission to invoke anything now.

Migration abbreviations used below:

- CP = `supabase/migrations/20260820121000_create_public_source_control_plane.sql`.
- CA = `supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql`.
- HA = `supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql`.
- GA = `supabase/migrations/20260822123000_govern_australian_source_activation.sql`.

| Exact signature | Final definition | Final explicit service-role GRANT |
| --- | --- | --- |
| `record_public_source_activation_event(jsonb)` | HA 54–123 | HA 740 |
| `create_public_source_fetch_manifest(text,text,text,uuid,text,text,text,uuid)` | HA 125–158 | HA 741 |
| `stage_public_source_version(jsonb)` | HA 160–299 | HA 742 |
| `activate_public_source_version(jsonb)` | HA 357–501 | HA 743 |
| `transition_public_source_version(uuid,text,text,text,text,text)` | HA 507–541 | HA 744 |
| `record_unchanged_public_source_check(jsonb)` | HA 543–567 | HA 745 |
| `tombstone_public_source_version_for_review(uuid,text,text,text,text,text)` | HA 569–601 | HA 746 |
| `public_source_serving_authority_stamp()` | CA 316–326 | CA 753 |

Their matching final REVOKE ALL FROM PUBLIC, anon, authenticated statements are HA 727–729,732–735 and CA 737 respectively. The obsolete `transition_public_source_version(uuid,text,text,text,text,text,uuid)` was explicitly revoked from PUBLIC, anon, authenticated and then dropped at HA 503–505; its DROP removes the function and its old ACL, including any service-role grant. Do not recreate or regrant it.

## Selected internal helpers and exact final ACL declarations

Every row below has the effective explicit statement `REVOKE ALL ON FUNCTION public.<signature> FROM PUBLIC, anon, authenticated` at the cited location. **None of these statements names service_role and no explicit service_role GRANT for these internal helpers was found.** Their present service-role EXECUTE is therefore explained by the encoded defaults, subject to actual ownership/default application. Narrow explicit service-role revocation would change effective authority; it is not merely copying the old declaration.

| Exact signature | Final definition / mode | Final explicit REVOKE | Effective consumer |
| --- | --- | --- | --- |
| `reject_public_source_activation_event_mutation()` | CP 72–80; trigger, invoker | CP 716 | Events BEFORE UPDATE OR DELETE trigger, CP 84–86. |
| `guard_public_source_version_identity()` | CA 35–57; trigger, invoker | CP 717 | Versions BEFORE UPDATE trigger, CP 123–125. |
| `bump_public_source_serving_authority()` | CA 70–84; definer | CA 736 | HA event writer 110, activation 496, transition 538, tombstone 591; historical HA migration DO 694. |
| `public_source_acquisition_identity_digest(uuid)` | HA 4–52; stable definer | HA 726 | HA stage 200,294; activation 461. |
| `make_public_source_version_ineligible(uuid,text)` | HA 301–351; definer | HA 731 | HA event writer 107, one-argument wrapper 355, activation 470, transition 535, tombstone 589. |
| `make_public_source_version_ineligible(uuid)` | HA 353–355; definer | HA 730 | Compatibility wrapper retained; no effective remaining source/SQL caller found after HA replacements. It calls the two-argument helper. |
| `public_source_document_is_serving_eligible(uuid)` | HA 603–633; stable definer | HA 737 | HA document trigger helper 642 and artifact trigger helper 703; historical migration backfill 664. |
| `require_active_public_source_version_for_publication()` | HA 635–646; trigger, definer | HA 738 | Documents constraint trigger, CA 374–377. |
| `require_active_public_source_artifact_for_publication()` | HA 699–707; trigger, definer | HA 736 | Eight named artifact constraint triggers, HA 710,712,714,716,718,720,722,724. |
| `require_document_publication_approval_state_digest()` | GA 29–77; trigger, invoker | GA 79 | Publication-approval BEFORE INSERT trigger, GA 82–84. Included because this is selected D1 closure. |
| `guard_document_publication_transition()` | CA 379–465; trigger, invoker | GA 263 | Documents publication BEFORE INSERT OR UPDATE trigger, `20260717131000_guard_document_publication_approval.sql:92–94`. Included because already selected prerequisite closure. |

The trigger functions are reached by installed triggers; no source calls them as ordinary RPCs. Their invoker/definer distinction is recorded rather than assuming all selected functions are privileged. Existing trigger invocation and creation privileges must be tested on the actual supported database version at separately authorized SQL acceptance. A trigger binding is not evidence that direct service-role RPC EXECUTE must remain granted. Revoking privileges from service_role does not revoke privileges from postgres or an independently privileged definer owner.

Do not expand this list automatically to generic helpers such as publication digests, generation predicates, updated-at, webhook or title-word functions. Those are shared dependencies with different consumers and fall outside this narrow ACL question.

## Exact table ACL, migration mutations and ownership limits

Final named table statements are:

```sql
-- CP 67–70
REVOKE ALL ON TABLE public.public_source_activation_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.public_source_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_source_activation_events TO service_role;
GRANT SELECT ON TABLE public.public_source_versions TO service_role;
-- CA 67–68
REVOKE ALL ON TABLE public.public_source_serving_authority FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_source_serving_authority TO service_role;
```

RLS is enabled at CP 64–65 and CA 66. SELECT grants are additive. Default-privilege owner `supabase/migrations/20260719055609_repair_postgres_default_privileges.sql:126–143` first clears global/schema defaults for the named roles, then grants postgres-created public tables SELECT/INSERT/UPDATE/DELETE at 138–139 and functions EXECUTE at 142–143. No later explicit selected-object ACL alteration was found outside CP/CA/HA (or GA for the two selected publication triggers), and no later blanket public-schema grant was found by the scoped ACL search. This is source-chain analysis, not inspection of pg_class, pg_proc, ACL catalogs or role membership.

Effective direct table writers inside the final migration definitions:

| Selected table | Effective final writer and operation |
| --- | --- |
| `public_source_activation_events` | HA `record_public_source_activation_event(jsonb)` INSERT at 114–120. |
| `public_source_versions` | HA event writer UPDATE 108–109; stage INSERT 282–293 and acquisition digest UPDATE 295; activation UPDATE 471,473–477; transition UPDATE 537; tombstone UPDATE 590. All enclosing entrypoints are definer functions. |
| `public_source_serving_authority` | CA `bump_public_source_serving_authority()` UPDATE 78–81, reached from the named definer entrypoints above. |

Historical migration-only operations include CA activation-event sequence backfill UPDATE 14–17 and CA serving-authority seed INSERT 64–65. Superseded CP/CA function bodies also contain mutations, but HA replaces their effective owners. These are migration-owner operations, not legitimate evidence of service_role direct-table mutation consumers. Do not copy or execute historical backfills to implement an ACL amendment. No selected-table DELETE/TRUNCATE operation was found in the effective functions.

The source files do **not** explicitly assign SQL ownership of the three tables or selected functions. Creation belongs to the executing role; CREATE OR REPLACE preserves an existing function's ownership. Thus `postgres` is the expected replay-owner assumption derived from the encoded defaults, not a verified installed object owner. Require an eventual owner/role/ACL assertion before claiming the proposed privilege state is enforced.

## Smallest reviewable disposition and acceptance gap

The proposed local amendment can name only these three tables and the selected internal helper signatures, explicitly retaining SELECT plus the eight governed entrypoint grants. It need not change application code, global default privileges, the serving-stamp API, source activation semantics, or unrelated tables. Table privilege removal and internal-helper removal should be separately stated, because they close different direct-call paths.

For independent xhigh review: verify the exact proposed ACL statements against this caller inventory and the frozen U03 additions; confirm no new U03 source consumer directly calls an internal P05 helper; confirm migration and snapshot final ACL ordering. Static focused contracts may pin those statements and preserved entrypoint grants, but cannot establish installed SQL privilege behavior.

Separately authorized SQL acceptance must verify actual owners/role inheritance and effective table/function privileges, denied direct mutations/internal calls, retained SELECT and named entrypoint execution, and unchanged positive/negative trigger behavior. No such operation ran here. Do not label this dependency inventory as acceptance or as proof that all external integrations remain compatible.

Method: immutable `git grep -n/-l -i -E` over only the requested tracked source trees/migrations, followed by `git show` of exact matching owners and source call sites. A first instruction-file enumeration attempted unsupported `git ls-tree` exclude pathspec syntax and failed before enumeration; corrected enumeration named only src/scripts/supabase and found no nested AGENTS.md. No retry changed repository state. Root AGENTS and prior task boundary instructions were retained. Searches cover static named references, not arbitrary external clients or runtime-generated identifiers.
