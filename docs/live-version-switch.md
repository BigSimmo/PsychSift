# Live version switch

Lets the site owner use new work on the live site (psychiatry.tools), with real
data and real behaviour, before it is on for everyone. Code: `src/lib/live-version/`
and `src/components/live-version/`.

## Who sees it

Testers only, decided on the server from the signed-in user the proxy verified:

- the administrator (`app_metadata.site_role = administrator`), or
- a user whose app metadata has `work_mode_preview: true` (Supabase dashboard), or
- a user id listed in the Railway variable `WORK_MODE_PREVIEW_USER_IDS`.

A tester sees **Settings, App preferences, Live version** with two choices:
**Newest** (the default) and **Everyone's**. If that row is not there when signed
in, the account is not a tester yet. Nobody else sees the row, and a cookie set by
hand changes nothing for them.

For a tester the switch replaces the older "Hide new work screens" row, and any
classic cookie left from it is ignored. The choice is a device cookie (`psychsift-live-version`). Changing it reloads the
page. Sign-out clears it through `clearAccountScopedBrowserStorage`.

## Landing new work behind it

1. Add an entry to `LIVE_PREVIEW_FEATURES` in `src/lib/live-version/features.ts`.
2. Gate the work with that id: `useLivePreview(id)` or `<LivePreview feature={id}>`
   in a component, `isLivePreviewOn(id)` in a server component, or
   `requireLivePreview(id)` at the top of a page that only exists in the newest version.
3. Merge. The work is live for testers only.
4. To launch to everyone, remove the gate and the entry in one change.

The new work-mode screens are the first entry. Under `WORK_MODE_LAUNCH=preview`
they follow the switch; under `everyone` they are on for all and the switch no
longer holds them back.

Outside production, and in the offline Playwright build, every preview feature is
on by default and the Settings row is hidden unless the user is a tester.
