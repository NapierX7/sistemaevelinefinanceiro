import { ReactNode, useState } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import BottomNav from './BottomNav'

export default function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    <div className="min-h-screen flex bg-ink-50 text-ink-900">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onOpenSidebar={() => setSidebarOpen(true)} />

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 overflow-x-hidden lg:pb-8 mobile-pad-bottom">
          <div className="mx-auto w-full max-w-7xl">
            {children}
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
