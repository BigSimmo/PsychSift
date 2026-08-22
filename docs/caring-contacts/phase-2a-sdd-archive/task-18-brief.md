### Task 18: One renderer, twenty-four overlays

**Files:**

- Create: `src/components/caring-contacts/workspace/overlays/overlay-host.tsx`
- Modify: `src/components/caring-contacts/workspace/shell.tsx` (mount the host)
- Test: `tests/caring-contacts-overlay-host.dom.test.tsx` (new)

**Interfaces:**

```tsx
export type OverlayHostProps = {
  openOverlayId: string | null;
  onClose: () => void;
  onCommit: (definition: WorkspaceOverlayDefinition) => void;
  blockReason: string | null; // a named permission/connectivity refusal, or null
};
export function OverlayHost(props: OverlayHostProps): JSX.Element | null;
```

**Rules — every one of these is a contract, not a preference:**

1. **One renderer.** Modality comes from the table, never from a per-overlay component. A generic one-modality `Sheet` path is explicitly not an acceptable substitute, and neither is 24 bespoke components.
2. Modality is chosen as `widthStateFor(viewportWidth) === "compact" ? phoneModality : desktopModality`. Use the shared `widthStateFor` from Task 15; do not write a second `matchMedia` breakpoint.
3. The rendered body stamps `data-overlay-id`, `data-overlay-modality` and `data-overlay-dismissal` on its content element. The Playwright matrix in Task 19 asserts against these.
4. `status-banner` portals to the document body as `role="status"`, is **not** a dialog, and never traps focus.
5. `session-gate` ignores Escape and the backdrop; it offers a recovery action only.
6. Everything else uses the shared `Sheet` from `src/components/ui/sheet.tsx` — `mobilePlacement="fullscreen"` for `full-screen-stage`, right-edge geometry for `inspection-drawer`, `mobilePlacement="bottom"` otherwise — with `returnFocusRef` supplied so focus returns to the originating control on close.
7. Overlay state is represented in the URL as `?overlay=<id>` so it supports browser history; closing removes the parameter.
8. `requiresFreshAuthentication` overlays commit only on the **second** activation: the first shows a visible fresh-authentication checkpoint and commits nothing.
9. When `blockReason` is non-null, a mutating overlay's primary action becomes `aria-disabled="true"` with the named reason visible and does nothing when clicked; **read-only overlays stay fully usable**, including their action.

- [ ] **Step 1: Write the failing test**

```tsx
describe("the overlay host", () => {
  it("renders every one of the 24 overlays with its frozen modality at both widths", () => {
    for (const definition of WORKSPACE_OVERLAY_DEFINITIONS) {
      for (const [width, expected] of [
        [390, definition.phoneModality],
        [1440, definition.desktopModality],
      ] as const) {
        setViewportWidth(width);
        const { unmount } = render(
          <OverlayHost openOverlayId={definition.id} onClose={noop} onCommit={noop} blockReason={null} />,
        );
        const body = screen.getByTestId("workspace-overlay-content");
        expect(body).toHaveAttribute("data-overlay-id", definition.id);
        expect(body).toHaveAttribute("data-overlay-modality", expected);
        expect(body).toHaveAttribute("data-overlay-dismissal", definition.dismissal);
        unmount();
      }
    }
  });

  it("returns focus to the control that opened the overlay", async () => {
    // open from a named trigger, press Escape, assert the trigger is focused
  });

  it("keeps the session gate open through Escape", async () => {
    render(<OverlayHost openOverlayId="session-expiry" onClose={onClose} onCommit={noop} blockReason={null} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never traps focus in the offline status banner", () => {
    render(<OverlayHost openOverlayId="offline-banner" onClose={noop} onCommit={noop} blockReason={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits a withdrawal only on the second activation", async () => {
    const onCommit = vi.fn();
    render(<OverlayHost openOverlayId="withdrawal" onClose={noop} onCommit={onCommit} blockReason={null} />);
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/fresh authentication checkpoint/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("blocks a mutating overlay with a named reason but leaves a read-only overlay usable", async () => {
    render(<OverlayHost openOverlayId="pause" onClose={noop} onCommit={noop} blockReason="permission-unavailable" />);
    const action = screen.getByRole("button", { name: /pause/i });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).not.toHaveAttribute("disabled");
    expect(screen.getByText(/permission/i)).toBeInTheDocument();

    cleanup();
    render(
      <OverlayHost
        openOverlayId="message-preview"
        onClose={noop}
        onCommit={noop}
        blockReason="permission-unavailable"
      />,
    );
    expect(screen.getByRole("button", { name: /close/i })).not.toHaveAttribute("aria-disabled");
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `overlay-host.tsx`.**
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line — the first test alone is 48 assertions.
- [ ] **Step 5: Prove it can fail — three mutations.** Always use `desktopModality` → the first test goes red at 390. Commit on the first withdrawal activation → the fresh-auth test goes red. Apply `blockReason` to read-only overlays too → the last test goes red. Revert each.
- [ ] **Step 6: Commit**

```bash
git add src/components/caring-contacts/workspace/overlays/overlay-host.tsx src/components/caring-contacts/workspace/shell.tsx tests/caring-contacts-overlay-host.dom.test.tsx
git commit -m "feat(caring-contacts): one overlay renderer honouring the frozen modality and dismissal matrix"
```

---
