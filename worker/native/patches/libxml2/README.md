These patches target Debian source
`2.12.7+dfsg+really2.9.14-2.1+deb13u3`, whose actual implementation is 2.9.14.
The component manifest pins the original DSC and every patch. Trusted APT source
retrieval authenticates the inputs. Source preparation applied all 40 existing
Debian patches and these five patches with GNU patch `--fuzz=0`.

The CVE-2026-86138 and CVE-2026-86140 patches are unchanged upstream patches.
The other three require these explicit adaptations:

- CVE-2026-86142 uses the existing `xmlXPtrErrMemory("allocating buffer")`
  helper, matching the adjacent allocation-failure branch. It retains the atomic
  allocator, overflow condition, name cleanup and early return. The actual u3
  `xmlstring.c` already counts with `size_t` and returns
  `len > INT_MAX ? 0 : len`; the upstream zero-on-overflow prerequisite is present.
- CVE-2026-86143 preserves buffer sizes as `size_t` until the `INT_MAX` check.
  It guards both legacy `Write` and `WriteEscape` dispatches, and both `Flush`
  branches. This covers all six callback sites; the newer implementation merges
  paths that are separate in 2.9.14. Existing callback and error APIs remain.
- CVE-2026-86144 propagates options before the existing `xmlLoadExternalEntity`
  text loader, inherits document options in both no-flags wrappers, and handles
  a NULL parser context through the existing XInclude allocation-error helper.
  New resource-loader APIs and network-error enums are not introduced.

CVE-2026-86139 needs no additional patch: the actual Debian source already has
`len = xmlStrlen(str); if (!(len > 0)) return(NULL);` in `xmlURIEscapeStr`,
equivalent to the guard in upstream commit
`8edbbdb09f24d26a2f900141fddc2b9d014f53b0`.
CVE-2026-74860 uses the exact one-line upstream Python SAX reference-count
repair from commit `046931e64e9e081e82c341f6455d070716fb8cf2`, rebased to the
2.9.14 function context. The built Python extension must pass the separate
enumeration ownership controls.

CVE-2026-6653 remains unresolved. Its larger vendor backport changes public
entity/input structures; it is excluded pending compatibility evidence.

Normal Debian features, build flags and tests remain in place. No public header,
exported signature, symbol list or SONAME is changed by these patches.
The additional regression script must compile and run against the newly built
`builddir/main/.libs/libxml2.so.2`; its C harness checks the resolved loaded
library path, ordinary valid XML, and twelve XInclude option/loader cases using
the two unchanged upstream issue1120 fixtures. Its loader never delegates
XInclude requests to a real network loader.

The source checks do not prove binary ABI compatibility or vulnerability closure.
The targeted runtime test covers CVE-2026-86144 and an ordinary parse control.
Dedicated overflow-boundary runtime coverage for CVE-2026-86138, 86140, 86142
and 86143 remains a gap; the large-length cases can require multi-gigabyte
inputs and must not be replaced by smaller inputs while claiming the same proof.
Normal builds, upstream checks, the added runtime test, representative consumer
loading and an exact-image scan are required before claiming repair or any
finding-count reduction. ASan coverage is not claimed by this normal-build test.
