"use client";

import { DynamicWidget } from "@dynamic-labs/sdk-react-core";

export function Header() {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center">
          <svg
            width="18"
            height="18"
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
        <span className="font-semibold text-gray-900 text-base">
          Polymarket Agent
        </span>
      </div>

      <DynamicWidget />
    </header>
  );
}
