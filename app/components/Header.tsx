'use client';

import Link from 'next/link';
import { Building2, Map, Users } from 'lucide-react';
import { usePathname } from 'next/navigation';

export default function Header() {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  return (
    <header className="border-b border-[#2A2F33]/20 bg-white sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#D39B1A] to-[#B8850F]">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-[#07111E]">LA Contractors</span>
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              href="/"
              className={`text-sm font-medium transition-colors ${
                isActive('/') && pathname === '/'
                  ? 'text-[#D39B1A]'
                  : 'text-[#2A2F33]/60 hover:text-[#07111E]'
              }`}
            >
              Home
            </Link>
            <Link
              href="/contractors"
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                isActive('/contractors')
                  ? 'text-[#D39B1A]'
                  : 'text-[#2A2F33]/60 hover:text-[#07111E]'
              }`}
            >
              <Users className="h-4 w-4" />
              Contractors
            </Link>
            <Link
              href="/map"
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                isActive('/map')
                  ? 'text-[#D39B1A]'
                  : 'text-[#2A2F33]/60 hover:text-[#07111E]'
              }`}
            >
              <Map className="h-4 w-4" />
              Map
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}