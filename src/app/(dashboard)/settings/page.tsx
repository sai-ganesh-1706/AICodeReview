import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold text-[#111]">Settings</h1>
        <p className="text-[13px] text-[#555] mt-0.5">
          Manage your account and preferences
        </p>
      </div>

      {/* Account section */}
      <div className="bg-white border border-[#e5e5e3] rounded-lg p-3.5 mb-2.5">
        <p className="text-[15px] font-semibold text-[#111] mb-3">Account</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-[#888] uppercase tracking-wide">
                Name
              </p>
              <p className="text-[13px] text-[#111] mt-0.5">
                {session.user.name ?? "—"}
              </p>
            </div>
          </div>
          <div className="border-t border-[#e5e5e3] pt-3">
            <p className="text-[11px] font-medium text-[#888] uppercase tracking-wide">
              Email
            </p>
            <p className="text-[13px] text-[#111] mt-0.5">
              {session.user.email ?? "—"}
            </p>
          </div>
          <div className="border-t border-[#e5e5e3] pt-3">
            <p className="text-[11px] font-medium text-[#888] uppercase tracking-wide">
              Plan
            </p>
            <p className="text-[13px] text-[#111] mt-0.5">Free</p>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-white border border-[#e5e5e3] rounded-lg p-3.5">
        <p className="text-[15px] font-semibold text-[#111] mb-1.5">
          Sign out
        </p>
        <p className="text-[13px] text-[#555] mb-3">
          Sign out of your ReviewAI account.
        </p>
        <a
          href="/api/auth/signout"
          className="inline-flex items-center px-3 py-1.5 bg-white border border-[#e5e5e3] text-[13px] font-medium text-[#111] rounded-md hover:bg-[#f5f5f4] transition-colors duration-150"
        >
          Sign out
        </a>
      </div>
    </div>
  );
}
