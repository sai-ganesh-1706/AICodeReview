import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { relativeTime } from "@/lib/utils";
import ToggleSwitch from "./ToggleSwitch";

async function toggleRepoActive(repoId: string) {
  "use server";
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return;
  await prisma.repository.update({
    where: { id: repoId },
    data: { active: !repo.active },
  });
  revalidatePath("/repositories");
}

export default async function RepositoriesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const repos = await prisma.repository.findMany({
    where: { userId: session.user.id },
    include: {
      _count: { select: { reviews: true } },
      reviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const installUrl = "https://github.com/apps/reviewai-local-test/installations/new";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-[#111]">
            Repositories
          </h1>
          <p className="text-[13px] text-[#555] mt-0.5">
            {repos.length} connected
          </p>
        </div>
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#111] text-white text-[13px] font-medium rounded-md hover:bg-[#333] transition-colors duration-150"
        >
          Connect repository
        </a>
      </div>

      {/* Repo list */}
      {repos.length === 0 ? (
        <div className="bg-white border border-[#e5e5e3] rounded-lg p-3.5 text-center">
          <p className="text-[13px] text-[#888] mb-2">
            No repositories connected yet
          </p>
          <p className="text-[11px] text-[#888]">
            Install the ReviewAI GitHub App on your repositories to get started.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#e5e5e3] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e5e3]">
                <th className="text-left text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                  Repository
                </th>
                <th className="text-left text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                  PRs Reviewed
                </th>
                <th className="text-left text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                  Last Reviewed
                </th>
                <th className="text-right text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                  Active
                </th>
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => {
                const lastReview = repo.reviews[0]?.createdAt;
                return (
                  <tr
                    key={repo.id}
                    className="border-b border-[#e5e5e3] last:border-b-0"
                  >
                    <td className="px-3.5 py-3">
                      <p className="text-[13px] font-medium text-[#111]">
                        {repo.repoFullName}
                      </p>
                    </td>
                    <td className="px-3.5 py-3">
                      <p className="text-[13px] text-[#555]">
                        {repo._count.reviews}
                      </p>
                    </td>
                    <td className="px-3.5 py-3">
                      <p className="text-[13px] text-[#888]">
                        {lastReview ? relativeTime(lastReview) : "Never"}
                      </p>
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <ToggleSwitch
                        repoId={repo.id}
                        active={repo.active}
                        toggleAction={toggleRepoActive}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Install instructions */}
      <div className="mt-5 bg-white border border-[#e5e5e3] rounded-lg p-3.5">
        <p className="text-[15px] font-semibold text-[#111] mb-1.5">
          Connect a new repository
        </p>
        <p className="text-[13px] text-[#555] leading-relaxed">
          To add repositories, install the ReviewAI GitHub App. Click
          &quot;Connect repository&quot; above or visit your GitHub App
          installation settings. Once installed, repositories will appear here
          automatically when a webhook event is received.
        </p>
      </div>
    </div>
  );
}
