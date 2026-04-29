"use client";

/**
 * AddToWalletButtons
 *
 * Renders "Add to Apple Wallet" and "Add to Google Wallet" buttons for a
 * given ticket. Each button fetches the appropriate pass from the API and
 * either triggers a .pkpass download (Apple) or navigates to the Google
 * Wallet save URL (Google).
 *
 * Props:
 *   ticketId — UUID of the ticket the user wants to add to their wallet
 *
 * The component uses separate loading / error states per platform so that
 * a failure on one platform doesn't block the other.
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// SVG badges (inline — no external image dependencies)
// ---------------------------------------------------------------------------

/**
 * Official Apple "Add to Apple Wallet" badge SVG.
 * Sourced from Apple's Pass guidelines (simplified monochrome version).
 */
function AppleWalletBadge(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 119.7 40"
      aria-hidden="true"
      className="h-10 w-auto"
    >
      <rect width="119.7" height="40" rx="5" ry="5" fill="#000" />
      <text
        x="59.85"
        y="15"
        textAnchor="middle"
        fill="#fff"
        fontSize="7"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
      >
        Add to
      </text>
      <text
        x="59.85"
        y="27"
        textAnchor="middle"
        fill="#fff"
        fontSize="13"
        fontWeight="600"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
      >
        Apple Wallet
      </text>
    </svg>
  );
}

/**
 * Google "Add to Google Wallet" badge SVG.
 * Simplified inline version matching Google's badge guidelines.
 */
function GoogleWalletBadge(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 40"
      aria-hidden="true"
      className="h-10 w-auto"
    >
      <rect width="200" height="40" rx="5" ry="5" fill="#fff" stroke="#dadce0" />
      {/* Google "G" mark colours */}
      <circle cx="20" cy="20" r="10" fill="#4285f4" />
      <circle cx="20" cy="20" r="6" fill="#fff" />
      <rect x="20" y="14" width="6" height="6" fill="#4285f4" />
      <text
        x="38"
        y="25"
        fill="#3c4043"
        fontSize="13"
        fontWeight="500"
        fontFamily="'Google Sans', Roboto, Arial, sans-serif"
      >
        Add to Google Wallet
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface GoogleWalletResponse {
  jwt: string;
  addToWalletUrl: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AddToWalletButtonsProps {
  ticketId: string;
}

export function AddToWalletButtons({
  ticketId,
}: AddToWalletButtonsProps): JSX.Element {
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Apple Wallet: fetch .pkpass binary → trigger download
  // -------------------------------------------------------------------------

  async function handleAppleWallet(): Promise<void> {
    setAppleLoading(true);
    setAppleError(null);

    try {
      const response = await fetch(`/api/tickets/${ticketId}/wallet/apple`, {
        method: "GET",
        // Credentials are sent automatically (session cookie); adjust if using
        // Authorization header-based auth in your setup.
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      // Stream the .pkpass binary and trigger a browser download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ticket-${ticketId}.pkpass`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // Clean up the object URL after a short delay
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Nepodařilo se stáhnout Apple Wallet pass.";
      setAppleError(message);
      console.error("[AddToWalletButtons] Apple error:", err);
    } finally {
      setAppleLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Google Wallet: fetch JWT → navigate to pay.google.com/gp/v/save/{jwt}
  // -------------------------------------------------------------------------

  async function handleGoogleWallet(): Promise<void> {
    setGoogleLoading(true);
    setGoogleError(null);

    try {
      const response = await fetch(`/api/tickets/${ticketId}/wallet/google`, {
        method: "GET",
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = (await response.json()) as GoogleWalletResponse;
      // Navigate to Google Wallet save URL in the same tab
      window.location.href = data.addToWalletUrl;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Nepodařilo se otevřít Google Wallet.";
      setGoogleError(message);
      console.error("[AddToWalletButtons] Google error:", err);
    } finally {
      setGoogleLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
      {/* Apple Wallet button */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => void handleAppleWallet()}
          disabled={appleLoading}
          aria-label="Add to Apple Wallet"
          className={[
            "rounded-lg transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black",
            appleLoading ? "cursor-wait opacity-60" : "hover:opacity-90 active:opacity-75",
          ].join(" ")}
        >
          {appleLoading ? (
            <span className="flex h-10 items-center gap-2 rounded-lg bg-black px-5 text-white text-sm font-medium">
              <Spinner className="h-4 w-4" />
              Připravuji…
            </span>
          ) : (
            <AppleWalletBadge />
          )}
        </button>

        {appleError !== null && (
          <p role="alert" className="max-w-xs text-center text-xs text-red-600">
            {appleError}
          </p>
        )}
      </div>

      {/* Google Wallet button */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => void handleGoogleWallet()}
          disabled={googleLoading}
          aria-label="Add to Google Wallet"
          className={[
            "rounded-lg border border-[#dadce0] transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#4285f4]",
            googleLoading
              ? "cursor-wait opacity-60"
              : "hover:opacity-90 active:opacity-75",
          ].join(" ")}
        >
          {googleLoading ? (
            <span className="flex h-10 items-center gap-2 rounded-lg bg-white px-5 text-[#3c4043] text-sm font-medium">
              <Spinner className="h-4 w-4 text-[#4285f4]" />
              Připravuji…
            </span>
          ) : (
            <GoogleWalletBadge />
          )}
        </button>

        {googleError !== null && (
          <p role="alert" className="max-w-xs text-center text-xs text-red-600">
            {googleError}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner helper
// ---------------------------------------------------------------------------

function Spinner({ className = "" }: { className?: string }): JSX.Element {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
      />
    </svg>
  );
}

export default AddToWalletButtons;
