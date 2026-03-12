"use client";

import { useState, useEffect, useCallback } from "react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useWalletDelegation } from "@dynamic-labs/sdk-react-core";

interface DelegationStatus {
  delegated: boolean;
  address?: string;
  chain?: string;
}

export function DelegationGate({ children }: { children: React.ReactNode }) {
  const { authToken } = useDynamicContext();
  const { initDelegationProcess } = useWalletDelegation();

  const [status, setStatus] = useState<DelegationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [delegating, setDelegating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    if (!authToken) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/delegation/status", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        throw new Error(`Status check failed: ${res.status}`);
      }
      const data: DelegationStatus = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Failed to check delegation status:", err);
      setError("Could not check delegation status. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleGrantAccess = async () => {
    setDelegating(true);
    setError(null);
    try {
      await initDelegationProcess();
      // After delegation, re-check status (webhook may take a moment)
      // Poll a few times to detect the new delegation
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch("/api/delegation/status", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data: DelegationStatus = await res.json();
          if (data.delegated) {
            setStatus(data);
            break;
          }
        }
      }
    } catch (err) {
      console.error("Delegation process failed:", err);
      setError(
        "Delegation was not completed. Please try again or check your wallet."
      );
    } finally {
      setDelegating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Checking wallet access...</p>
        </div>
      </div>
    );
  }

  if (status?.delegated) {
    return <>{children}</>;
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-purple-50 mx-auto mb-5">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#7c3aed"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
          Grant Wallet Access
        </h2>
        <p className="text-gray-500 text-sm text-center mb-6 leading-relaxed">
          To let the AI agent trade on your behalf, you need to delegate access
          to your wallet. Your funds stay in your wallet — the agent can only
          act within the limits you set.
        </p>

        <ul className="space-y-3 mb-7">
          {[
            "Agent trades using your own wallet",
            "You can revoke access at any time",
            "All actions are logged",
            "No funds are moved to a third party",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
              <svg
                className="mt-0.5 shrink-0"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#7c3aed"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {item}
            </li>
          ))}
        </ul>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleGrantAccess}
          disabled={delegating}
          className="w-full py-3 rounded-xl bg-brand text-white font-medium text-sm hover:bg-purple-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {delegating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Setting up access...
            </>
          ) : (
            "Grant Access"
          )}
        </button>
      </div>
    </div>
  );
}
