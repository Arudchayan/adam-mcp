# Sidebar link incorrectly corroborates unparsed content rows as successful inventory

Severity: medium inventory correctness (P2). Tested source `ef9776e`; independently reproduced in disposable intercepted Chrome.

```sh
node --import tsx --test --test-name-pattern="D3:" packages/provider-browser/qa/adversarial-discovery/findings.repro.ts
```

Synthetic DOM:

```html
<main><div id="il_center_col">
  <div class="ilContainerListItemOuter">Visible row without a parseable link</div>
</div></main>
<aside><a href="/go/file/710099">Unrelated sidebar file</a></aside>
```

Expected: unknown/unparsed listing with no verified child inventory.

Actual: listingState ok with sidebar file 710099 as a child.

The row probe is content-scoped, but link collection is document-wide and does not mark this outside-content sidebar as chrome. Classification compares aggregate counts without correlating the parsed links to those rows. This can also suppress the new unresolved-folder diagnostic.

## Acceptance

Correlate child identity/link evidence with the actual content region/row while preserving same-origin content-frame support. Test sidebar/navigation/breadcrumb contamination and populated/empty/unknown parity. Keep unresolved rows honest rather than inferring empty.

All requests are intercepted and use synthetic content; no personal session/profile or live occurrence is claimed. Distinct from search resurrecting correctly suppressed objects: this corrupts listing classification itself.
