# AGENTS.md - Base Context for `mock-loom`

## 1) Purpose
This file defines the minimum mandatory operating context for any agent or collaborator working in this repository.

The project goal is to build a **Rule-Based API Mocking Engine** with stateful behavior, dynamic rules, and entity-level rollback capabilities.

## 2) Mandatory reading order for initial context
1. `docs/blue_print.md`
2. `docs/ux.md`
3. `docs/specs/README.md`
4. Specs in `docs/specs/` with status `Ready`

Do not start implementation without completing this reading order.

## 3) Design: location and source of truth
- UI v2 canonical source: `docs/desing/` assets (`system_consistency_board`, app shell, and screen/state exports).
- Legacy node mapping is documented in `docs/systemDesign.md`; do not reuse historical markup/style patterns for UI v2 implementation.
- Mandatory v2 design reading sequence:
  1. `docs/desing/system_consistency_board`
  2. `docs/desing/app_shell_master_layout`
  3. `docs/desing/application_flow_overview`
  4. Screen bundles and variants: A (`screen_a_*`), B (`screen_b_*`), C (`screen_c_*`), D (`screen_d_*`), E (`screen_e_*`)
- If historical mapping notes and `docs/desing` differ for UI v2, **prioritize `docs/desing`** as visual source of truth.

## 4) Non-negotiable engineering policy
- Always prioritize correct, simple, and maintainable code.
- Good engineering practices and clean design are above quick patches.
- If a solution is flawed by design and can be rebuilt quickly in a simpler, better way, **rebuild is mandatory**.
- Iterating on known-defective foundations or patching fundamentally wrong solutions is not allowed.
- Unless explicitly requested by the user, backward compatibility is **not** a default goal during refactors or redesigns.
- When existing code is low quality or structurally flawed, the default decision is to propose and implement root-cause corrections/refactoring instead of layering patches on top of bad foundations.

## 5) Rules to start implementation
- Do not start coding without a spec in `Ready` status.
- Every status change must be updated in:
  - the spec file
  - `docs/specs/README.md`
- Official status flow: `Draft -> Ready -> In Progress -> Done`.

## 6) Base technical conventions
### Frontend
- `feature-first` architecture.
- Clear separation between `app`, `features`, and `shared`.
- Strict TypeScript (`strict`) and equivalent safety flags enabled.
- Typed contracts and reusable components before ad-hoc variations.

### Go backend
- Simplified Ports/Adapters architecture (simplified hexagonal), initially focused on DB connectivity and persistence.
- Application layer must not depend on SQLite directly.
- HTTP handlers must not access DB directly.
- Rollback must use compensation events; physical deletion from event store is forbidden.

## 7) Mandatory language policy
- All code must be written in English.
- All code comments must be written in English.
- All documentation (including specs and agent docs) must be written in English.
- Identifiers, API contracts, and user-facing technical copy in this repository must default to English unless explicitly documented otherwise.

## 8) Mandatory process before starting and closing a spec
- Before starting any spec, analyze the full spec content and all dependencies.
- If there are doubts, ask and resolve them before starting implementation.
- Do not start implementation with open or ambiguous points in a spec.
- Before moving a spec to `In Progress`, analyze compatibility with existing implementation/documentation, especially if recent changes may affect the current spec.
- A spec can be closed (`Done`) only when all points are covered, acceptance criteria and tests are complete, and there are no design gaps.
- If scope, decisions, or behavior change during execution, add an **appendix** in the same spec file with:
  - decision description
  - why the change was made
  - technical/functional impact details

## 9) Canonical references
- `docs/blue_print.md`
- `docs/ux.md`
- `docs/specs/README.md`

## 10) Mandatory tool usage
- For visual validation/checks, always use `agent-browser`.
- For versions, documentation, and technical reference information, always use Context7 MCP as the primary source.

## 11) Mandatory DoD for UI v2
- Every screen/view/component is blocked by an exhaustive visual DoD before acceptance.
- Mandatory checks include: typography, colors, spacing, overlaps/clipping, hierarchy, interaction states, and responsive behavior.
- Mandatory viewport set for UI v2 visual QA: `375`, `768`, `1280`, `1920`.
- Mandatory skill stack for UI DoD:
  - `agent-browser` for capture and interaction checks
  - `audit-ui` for UI/UX audit severity reporting
  - `web-design-guidelines` for layout/responsive/accessibility guideline checks
  - `color-contrast-auditor` for WCAG 2.1 contrast compliance
- Any critical or high UI finding fails the bundle gate.

## 12) UI Action Affordance Style Guide
- Prefer icon-only actions (with tooltip) for contextual or row-level actions whenever feasible.
- Contextual and row/card actions labeled `Open` or `Edit` must be icon-only actions with tooltip and `aria-label`. Do not render textual `Open`/`Edit` buttons in those contexts.
- Use concise text buttons for primary/global actions (`Save`, `Publish`, `Create`, `Submit`) where label clarity is critical.
- Do not use `Select` for binary state toggles (`ACTIVE/INACTIVE`, enable/disable). Use a modern switch control.
- Use segmented controls for short exclusive modes (2-3 options) instead of `Select`.
- Modal header dismiss action must be an icon `X` button with tooltip and accessible name. Do not render textual `Close` in modal headers.
- Every icon-only action must include:
  - visible tooltip label
  - accessible name (`aria-label`)
  - clear disabled tooltip message when the action is unavailable
- Tooltip layering/clipping rule:
  - avoid placing icon actions inside wrappers with `overflow: hidden|auto|scroll` when the tooltip must escape bounds
  - prefer tooltip portal rendering for dense containers (tables, cards, drawers, modals) to prevent clipping
  - ensure tooltip z-index is above local surfaces and sticky headers
- Prefer consistent destructive affordances:
  - trash icon for remove/delete actions
  - destructive color token on hover/active states
- Keep action density compact in tables/cards by replacing secondary text buttons with icon actions when behavior remains unambiguous.
- Mandatory UI review pass for affordances and interaction consistency must use `web-design-guidelines`.
- Recommended implementation guidance: use a Vercel React design/system skill (if available in local skills) for React affordance patterns and interaction design consistency.
