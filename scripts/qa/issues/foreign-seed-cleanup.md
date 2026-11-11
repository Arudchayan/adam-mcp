# Failed holder start can remove another pending generation's handoff seed

Severity: low startup reliability. Tested source `ef9776e`; independently reproduced with a realistic foreign-seed-only pre-CDP interleaving.

```sh
node --import tsx --test --test-name-pattern="S2 " scripts/qa-public-session/repro.mjs
```

A failing start initially stops prior ownership. Before its timeout cleanup, another synthetic starter writes its different-generation seed, without publishing a record or starting CDP. Cleanup from the failed attempt removes the newer pending seed.

`session-holder.ts` cleanup uses fixed handoff filenames without checking ownership of that pending seed. The in-process queue does not establish a cross-process startup lock.

## Expected / acceptance

Cleanup must remove only files owned by the failing start. Cover overlapping independent starters and generation changes between check and removal. Keep the current protection for responding CDP and ambiguous live-process ownership.

No healthy newer holder was killed or its reachable ownership record erased. The ordinary holder consumes its seed before publishing its record; the repro does not assume both normally coexist. No actual profiles, Chrome, process signals or cookie values are used.
