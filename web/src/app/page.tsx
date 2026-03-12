"use client";

import { useDynamicContext, DynamicWidget } from "@dynamic-labs/sdk-react-core";
import { Header } from "@/components/Header";
import { DelegationGate } from "@/components/DelegationGate";
import { ChatInterface } from "@/components/ChatInterface";

export default function Home() {
  const { isAuthenticated } = useDynamicContext();

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-purple-50 to-white px-6">
        {/* Logo mark */}
        <div className="w-16 h-16 rounded-2xl bg-brand flex items-center justify-center mb-7 shadow-lg shadow-purple-200">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3 tracking-tight">
          Polymarket Agent
        </h1>
        <p className="text-gray-500 text-base text-center max-w-xs mb-2 leading-relaxed">
          Your AI-powered prediction market trader. Just chat — the agent does
          the rest.
        </p>
        <p className="text-gray-400 text-sm text-center max-w-xs mb-10">
          Powered by LangGraph · Dynamic · LI.FI
        </p>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl w-full mb-10">
          {[
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                </svg>
              ),
              title: "Your wallet",
              desc: "Trades happen on your own wallet",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              ),
              title: "Real-time",
              desc: "Live market data from Polymarket",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              ),
              title: "Non-custodial",
              desc: "Revoke access anytime",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-4"
            >
              <div className="mb-2">{f.icon}</div>
              <p className="text-sm font-medium text-gray-900">{f.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-gray-500">
            Connect your wallet to get started
          </p>
          <DynamicWidget />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <Header />
      <DelegationGate>
        <ChatInterface />
      </DelegationGate>
    </div>
  );
}
