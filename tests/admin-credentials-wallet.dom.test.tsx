/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminCredentialsWallet } from "@/components/admin/admin-credentials-wallet";
import * as storage from "@/lib/admin/credentials-storage";
import * as clipboard from "@/lib/copy-to-clipboard";

describe("AdminCredentialsWallet", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders credentials wallet with passcards", () => {
    render(<AdminCredentialsWallet />);
    expect(screen.getByText("Credentials Wallet")).toBeTruthy();
    expect(screen.getByText("Ahpra Registration")).toBeTruthy();
    expect(screen.getByText("Prescriber Number")).toBeTruthy();
    expect(
      screen.getByText("Stored on this device only. Use it on your own phone, not a shared ward computer."),
    ).toBeTruthy();
  });

  it("copies credential to clipboard and shows copied feedback pill", async () => {
    const copySpy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    storage.saveDoctorCredentials({
      ...storage.DEFAULT_CREDENTIALS,
      ahpraNumber: "MED0001234567",
    });

    render(<AdminCredentialsWallet />);

    const card = screen.getByTestId("admin-credentials-wallet-card-ahpra");
    expect(card.textContent).toContain("MED0001234567");

    fireEvent.click(card);

    await waitFor(() => {
      expect(copySpy).toHaveBeenCalledWith("MED0001234567");
      expect(screen.getByTestId("admin-credentials-wallet-copied-ahpra")).toBeTruthy();
      expect(screen.getByText("Copied!")).toBeTruthy();
    });
  });

  it("opens edit sheet to update numbers", async () => {
    render(<AdminCredentialsWallet />);
    const editBtn = screen.getByTestId("admin-credentials-wallet-edit-button");
    fireEvent.click(editBtn);

    expect(screen.getByText("Edit Doctor Credentials")).toBeTruthy();
    const saveBtn = screen.getByTestId("admin-credentials-wallet-save-button");
    fireEvent.click(saveBtn);
  });

  it("clears credentials upon account transition (sign-out / terminal switch)", async () => {
    storage.saveDoctorCredentials({
      ...storage.DEFAULT_CREDENTIALS,
      ahpraNumber: "MED0009999999",
    });

    render(<AdminCredentialsWallet />);
    expect(screen.getByTestId("admin-credentials-wallet-card-ahpra").textContent).toContain("MED0009999999");

    const { clearAccountScopedBrowserStorage } = await import("@/lib/account-scoped-browser-state");
    act(() => {
      clearAccountScopedBrowserStorage();
    });

    await waitFor(() => {
      expect(screen.getByTestId("admin-credentials-wallet-card-ahpra").textContent).not.toContain("MED0009999999");
    });
    expect(storage.loadDoctorCredentials().ahpraNumber).toBe("");
  });
});
