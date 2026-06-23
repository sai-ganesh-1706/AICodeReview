import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getInitials } from "@/lib/utils";
import { SidebarNav } from "./SidebarNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const initials = getInitials(session.user.name);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-[200px] shrink-0 bg-white border-r border-[#e5e5e3] flex flex-col">
        {/* Logo */}
        <div className="px-4 h-[52px] flex items-center gap-2 border-b border-[#e5e5e3]">
          <span className="w-2 h-2 bg-[#111] rounded-[1px]" />
          <span className="text-[15px] font-semibold text-[#111]">ReviewAI</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
          <SidebarNav />
        </nav>

        {/* User */}
        <div className="px-3 py-3 border-t border-[#e5e5e3] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#e5e5e3] flex items-center justify-center">
            <span className="text-[11px] font-medium text-[#555]">
              {initials}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-[#111] truncate">
              {session.user.name}
            </p>
            <p className="text-[11px] text-[#888]">Free plan</p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-[#f5f5f4] overflow-y-auto">
        <div className="p-6 max-w-[960px]">{children}</div>
      </main>
    </div>
  );
}
