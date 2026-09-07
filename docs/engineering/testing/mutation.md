# Mutation testing

[Testing and CI](../testing.md) links the measured results and coverage policy. Mutation tests check whether assertions detect an introduced defect. A killed mutant is evidence about that modification; timeouts are reported separately because a timeout is not an assertion.

## Two deliberate scopes

The pull-request job mutates runtime capability validation and plan/execution policy. It uses isolated Vitest tests, synthetic keys, no database and no network. Its minimum score remains 90%. The verified expansion killed 70 of 75 mutants (93.33%), without uncovered mutants, timeouts or errors. The five remaining mutations remove non-contract error explanations; status codes and policy decisions are asserted.

The separate scheduled/manual workflow mutates delegated authorization, the integer ledger and the snapshot restore routine. It provisions a disposable PostgreSQL database and uses temporary files. Stryker works in a temporary source copy; production environment files, preview data, caches and build outputs are not copied into the sandbox. Its measured floor is 85%, with a 90% improvement target. It does not run on each pull request.

The verified extended run scores **90.74% across 324 mutants**: 293 assertion kills, one timeout, 30 survivors and no uncovered mutants or errors. Delegated authorization scores 97.30%, the ledger 89.10%, and the selected restore routine 90.84%. The timeout contributes to Stryker's score but is not counted as an assertion kill. This local run completed in about three minutes; CI timing remains to be measured.

Restore's executable container entrypoint is outside this selective mutation range. That block needs the real Linux paths, UID and container fixture, which are covered separately by native acceptance. It remains visible in application coverage. This boundary avoids running a container image for every mutant and does not suppress uncovered application files.

## What survivors revealed

The first broader run exposed missing assertions for multi-lot reservation allocation, expiry journal idempotency, ledger account/reference identity, unsafe restore paths at the actual restore boundary, multi-digit transfer pages and independent chunk versus whole-file hash validation. Those behaviors now have explicit assertions using real PostgreSQL and files.

Other survivors need interpretation rather than tests of implementation details:

- Comparisons choosing between equal monetary values are equivalent at equality. Some extra zero-value SQL updates leave the financial contract unchanged.
- Removing an explanatory error string does not change the stable error code, denial, or preserved state.
- Sorting independent restore pages and filtering already-validated entry kinds can be redundant with earlier validation. UTF-8 JSON parsing from a Buffer is equivalent for these fixtures.
- Filesystem sync and ownership calls need stronger crash/UID acceptance. Current local filesystem outcomes alone cannot prove power-loss durability or Linux ownership semantics.
- Some redundant locks and default preferred-lot reference mutations are not distinguished by current transaction cases. Keep these visible for later concurrency audits; a surviving mutation does not prove the original lock is unnecessary.
- A decreasing ancestor-loop index produces a timeout. This is recorded separately from assertion kills.

Do not disable all string/SQL mutations or assert arbitrary message prose to force a higher score. Inspect the JSON/HTML evidence, distinguish equivalent behavior from missing protection, and extend tests where the observable contract matters.

## Invocation and evidence

```sh
pnpm test:mutation
pnpm test:mutation:critical
```

Reports live in `reports/mutation` and `reports/mutation-critical`, with HTML and JSON outputs. CI retains them for seven days. A failed mutation floor fails its job; the scheduled workflow does not deploy or change production state. Default fixtures require no production secrets and perform no paid provider calls.
