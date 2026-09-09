# U03 historical test-discovery qualification

Recorded on 9 September 2026 during U04 preparation. This is an additive qualification of execution assurance, not a replacement of the immutable U03 acceptance, test results or independent product reviews. No U03 gate was rerun and no product source changed.

The recorded U03 Vitest commands supplied named test files. Current installed Vitest source calls `globAllTestFiles` before applying those filename filters (`node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:10776-10779`). The recorded config includes the broad node and jsdom test patterns. Consequently, a named-file selector establishes which suites were selected, but does not by itself establish that unrelated untracked test filenames were never enumerated. Current tinyglobby also crawls a common directory for literal include paths, so an explicit include array alone is insufficient to prove that stronger property.

This does not establish that an unrelated untracked file actually existed, was read or executed during U03. The configured test includes do not traverse the protected root `1/`. No new provider, real-document or other connected operation is evidenced. Do not manufacture a retrospective filesystem observation from the present source inspection.

The recorded executed suites, results, input identities and source/offline review conclusions remain preserved. Earlier receipt/arbiter/migration discovery restrictions were applied and remain necessary. U03's local product acceptance stands within its stated limits; it is not evidence of exact test-path discovery isolation. No historical run is relabelled as having used the prospective U04 explicit-discovery adapter.

Observed current source hashes: Vitest CLI implementation `a2d629ec07fbaf58055bca9858076c6c13763042d97196272c45ccfdb727f498`; tinyglobby implementation `fc1bed0d5da56d4638002af7deaf6d179e183a85de648c180839ca36b21b3b50`; `vitest.config.mts` `c9e57e014bcf37baabc368b237d20638eca8507df7bc93873103b9b25107add8`. These are current inspection identities, not reconstructed historical observations.

Before U04 tests, the controller must admit a reviewed exact-discovery mechanism and preserve all mandated suites/assertions, offline environment, coordinator and failure accounting. The required schema suite's separate physical migration enumeration must also be resolved. Neither that future mechanism nor this qualification waives the required U04 offline evaluation or inherits U02's non-green exception.
