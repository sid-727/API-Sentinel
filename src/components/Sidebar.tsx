'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Shield, LayoutDashboard, Terminal, Activity } from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Security Playground', href: '/playground', icon: Terminal },
  ];

  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-900 flex flex-col justify-between shrink-0 h-screen sticky top-0">
      {/* Top Section */}
      <div>
        {/* Brand Logo */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-zinc-900">
          <div className="bg-indigo-600/10 border border-indigo-500/30 p-1.5 rounded-lg">
            <Shield className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wider font-mono">API SHIELD</h1>
            <span className="text-[10px] text-zinc-500 font-mono">SECURE GATEWAY</span>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="p-4 space-y-1.5">
          {navigation.map((item) => {
            const isActive = pathname === item.href || (item.href === '/' && pathname === '/dashboard');
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-150 ${
                  isActive
                    ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.05)]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom Section */}
      <div className="p-4 border-t border-zinc-900 space-y-4">
        {/* Engine Status Summary */}
        <div className="bg-zinc-900/40 border border-zinc-900 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-500 font-mono">PROXY ENGINE</span>
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              ONLINE
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-500 font-mono">HEURISTICS (L1)</span>
            <span className="text-zinc-300 font-semibold">Active</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-500 font-mono">MICRO-LLM (L2)</span>
            <span className="text-zinc-300 font-semibold">Gemini Flash</span>
          </div>
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between text-[10px] text-zinc-600 px-2 font-mono">
          <span>Shield Core v1.0.0</span>
          <a href="#" className="hover:text-zinc-400">Docs</a>
        </div>
      </div>
    </aside>
  );
}
