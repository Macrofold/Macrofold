# Code review

Use this for requested reviews and the final review of your own changes. Review the actual diff plus enough surrounding code, callers, tests, and contracts to evaluate it. Do not confuse an author's explanation, a generated patch, or a passing test with proof.

## Review in this order

1. **Intent and completeness:** does the changed user/API path work through its owning layers? Are there affected sibling callers, generated artifacts, migration requirements, or compatibility promises?
2. **Correctness and impact:** identify concrete failure scenarios. Prioritize unauthorized access, tenant leakage, money precision/reservations, lost files, duplicate side effects, broken lifecycle transitions, and externally visible regressions.
3. **Failure and concurrency:** inspect the changed path under stale/revoked authority, simultaneous work, retry, partial failure, disconnect, cancellation, and cleanup where applicable. Distinguish definitive failure from an unknown external result.
4. **Simplicity:** can existing code, a supported library operation, or a smaller coherent change solve this? Remove needless indirection and repeated policy. Keep intentional security/provider/recovery boundaries. Do not demand a framework rewrite, global deduplication, or future scale machinery.
5. **Evidence and UX:** do tests fail for the intended defect and cover the real boundary? Check loading/error/recovery and accessibility for interactions. Verify the final generated/public documentation agrees with behavior. Formatting belongs to existing tooling.

## Findings

Report only supported, actionable findings: affected file/lines, trigger or preconditions, observable impact, and the smallest reasonable repair direction. State uncertainty when a claim depends on an unverified provider or deployment behavior. Prefer a reproduction or concrete code path over a hypothetical edge case.

Separate blocking defects from optional maintainability suggestions and unrelated follow-ups. Do not promote naming preferences or speculative optimizations into correctness blockers. Avoid duplicate findings for one root cause. Keep an explicit scope inventory for repository-wide reviews; distinguish authored source review from generator/schema checks, exclude dependencies and private runtime data, and respect any requested round limit. A review may have no findings; report the scope and remaining verification gaps rather than inventing issues.

For a fix you implement, run relevant checks and reread the final diff, including accidental files and generated drift. For review-only requests, do not apply edits unless authorized. PR descriptions lead with the concrete problem and resulting behavior, then validation and material compatibility/operational implications.
