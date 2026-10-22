---
name: api-review
description: Reviews API routes for routing contracts, input schema validation (Zod), JSON error taxonomies, request/response models, pagination, authentication, recoverability, and HTTP status codes. Use during API code changes or integrations.
---

# API Review Skill

Use this skill when reviewing or modifying API routes, endpoints, or network boundaries within this repository (primarily under `src/app/api/`).

## Repository Review Protocol

Follow `AGENTS.md` review throttling and `docs/codex-review-protocol.md` before starting. Do not review opportunistically or mutate files during pure review. After a completed PR review, post one `Review record` comment on the PR (see [Records](../../../docs/agents/pull-request-workflow.md#records)); never edit the frozen `docs/branch-review-ledger.md` table.

## Review Checklist

### 1. Request Validation

- **Zod Schemas:** Ensure all incoming requests (`req.json()`, query parameters, route segments) are validated using strict Zod schemas.
- **Fail Early:** Requests failing schema validation must return `400 Bad Request` immediately before running downstream DB or AI logic.
- **Safety check:** Validate input boundaries (e.g., maximum string length, non-empty collections, limit boundaries on pagination).

### 2. Error Handling & Taxonomy

- **Closed Errors:** Avoid throwing raw database, library, or system errors to the client. Wrap exceptions in consistent JSON error envelopes.
- **HTTP Semantics:** Use correct HTTP status codes (e.g., `401 Unauthorized` vs `403 Forbidden`, `404 Not Found` for missing resources, `429 Too Many Requests` for rate limits).
- **Consistency:** Ensure error payloads follow a unified schema, containing a clear error code (e.g., `VALIDATION_FAILED`, `INTERNAL_ERROR`) and user-safe descriptions.

### 3. Response Contracts

- **Serialization:** Explicitly define the serialized JSON shape of the response. Avoid passing DB model instances directly to the frontend.
- **Pagination:** For resource listing APIs, verify pagination params (`limit`, `offset` / `cursor`) are implemented, validated, and bounded.

### 4. Authentication & Authorization

- **Server-Side Enforcement:** Do not rely on client assertions. Re-authenticate user credentials (JWT / session cookies) server-side.
- **Tenant Isolation:** Ensure fetched resources are filtered by the active user's identity (`user_id`).
