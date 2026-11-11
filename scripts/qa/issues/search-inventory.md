# Search returns child identities suppressed by empty or unknown listing classification

Severity: medium inventory correctness (P2). Tested source `ef9776e`; independently reproduced with synthetic memory pages and intercepted real DOM.

```sh
node --import tsx --test --test-name-pattern="D1:|D2:" packages/provider-browser/qa/adversarial-discovery/findings.repro.ts
```

- An explicitly empty dashboard contains a stray synthetic course link. listCourses correctly returns no items; global title search returns that course, without partial metadata. No course page is opened.
- A verified enrolled course has an unknown/blank listing with a stray file link. listChildren correctly returns no items; scoped title search returns that file, while correctly reporting partial/unknown listing.

Walk retention stores raw catalogs before classification prunes traversal; search iterates those catalogs without suppressing the unverified child identities.

## Expected / acceptance

Apply listing honesty consistently to discovered object identities. A child suppressed as empty/unknown inventory must not reappear as a verified title hit. Preserve legitimate current-page body matches, honest partial metadata, enrolled scope and traversal bounds. Add both empty-dashboard and unknown-nested-container regressions.

No unauthorized content access or navigation was demonstrated. Distinct from #86 (real blank folders) and #84 (Web Link destinations): this resurrects identities after correct listing suppression.
