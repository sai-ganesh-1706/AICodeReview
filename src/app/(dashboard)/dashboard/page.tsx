import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { relativeTime } from "@/lib/utils";
import Link from "next/link";

function scoreColor(score: number): string {
  if (score >= 80) return "text-[#16a34a]";
  if (score >= 60) return "text-[#b45309]";
  return "text-[#dc2626]";
}

function statusBadge(review: {
  comments: { severity: string }[];
}): { label: string; bg: string; text: string } {
  const hasCritical = review.comments.some((c) => c.severity === "CRITICAL");
  const hasWarning = review.comments.some((c) => c.severity === "WARNING");

  if (hasCritical)
    return { label: "Critical issues", bg: "bg-[#fef2f2]", text: "text-[#b91c1c]" };
  if (hasWarning)
    return { label: "Warnings", bg: "bg-[#fffbeb]", text: "text-[#b45309]" };
  return { label: "Clean", bg: "bg-[#f0fdf4]", text: "text-[#16a34a]" };
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id;

  // Fetch data
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [repos, recentReviews, totalReviews, reviewsWithScores] =
    await Promise.all([
      prisma.repository.findMany({
        where: { userId, active: true },
        include: {
          _count: { select: { reviews: true } },
          reviews: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),

      prisma.review.findMany({
        where: {
          repository: { userId },
          createdAt: { gte: thirtyDaysAgo },
        },
        include: {
          repository: { select: { repoFullName: true } },
          comments: { select: { severity: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),

      prisma.review.count({
        where: {
          repository: { userId },
          createdAt: { gte: thirtyDaysAgo },
        },
      }),

      prisma.review.findMany({
        where: {
          repository: { userId },
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { score: true, comments: { select: { id: true } } },
      }),
    ]);

  const totalIssues = reviewsWithScores.reduce(
    (sum, r) => sum + r.comments.length,
    0
  );
  const avgScore =
    reviewsWithScores.length > 0
      ? Math.round(
          reviewsWithScores.reduce((sum, r) => sum + r.score, 0) /
            reviewsWithScores.length
        )
      : 0;
  const activeRepoCount = repos.length;

  const metrics = [
    {
      label: "PRs Reviewed",
      value: totalReviews.toString(),
      sub: "Last 30 days",
    },
    {
      label: "Issues Found",
      value: totalIssues.toString(),
      sub: "Across all reviews",
    },
    {
      label: "Avg Score",
      value: reviewsWithScores.length > 0 ? avgScore.toString() : "—",
      sub: "Out of 100",
    },
    {
      label: "Avg Review Time",
      value: "<1m",
      sub: "Per pull request",
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-[#111]">Dashboard</h1>
          <p className="text-[13px] text-[#555] mt-0.5">
            Last 30 days · {activeRepoCount} active{" "}
            {activeRepoCount === 1 ? "repository" : "repositories"}
          </p>
        </div>
        <Link
          href="/repositories"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#111] text-white text-[13px] font-medium rounded-md hover:bg-[#333] transition-colors duration-150"
        >
          Add repository
        </Link>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-2.5 mb-5">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-white border border-[#e5e5e3] rounded-lg p-3.5"
          >
            <p className="text-[11px] font-medium text-[#888] uppercase tracking-wide">
              {m.label}
            </p>
            <p className="text-[22px] font-semibold text-[#111] mt-1">
              {m.value}
            </p>
            <p className="text-[11px] text-[#888] mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Recent reviews table */}
      <div className="mb-5">
        <h2 className="text-[15px] font-semibold text-[#111] mb-3">
          Recent reviews
        </h2>

        {recentReviews.length === 0 ? (
          <div className="bg-white border border-[#e5e5e3] rounded-lg p-3.5 text-center">
            <p className="text-[13px] text-[#888]">
              No reviews yet. Open a pull request on a connected repository to
              get started.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-[#e5e5e3] rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e3]">
                  <th className="text-left text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                    Pull request
                  </th>
                  <th className="text-left text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                    Repo
                  </th>
                  <th className="text-left text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                    Status
                  </th>
                  <th className="text-left text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                    Score
                  </th>
                  <th className="text-right text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentReviews.map((review) => {
                  const badge = statusBadge(review);
                  return (
                    <tr
                      key={review.id}
                      className="border-b border-[#e5e5e3] last:border-b-0 hover:bg-[#fafaf9] transition-colors duration-150"
                    >
                      <td className="px-3.5 py-3">
                        <Link
                          href={`/reviews/${review.id}`}
                          className="text-[13px] font-medium text-[#111] hover:underline"
                        >
                          {review.prTitle}
                        </Link>
                        <p className="text-[11px] text-[#888] mt-0.5">
                          #{review.prNumber}
                        </p>
                      </td>
                      <td className="px-3.5 py-3">
                        <p className="text-[13px] text-[#555]">
                          {review.repository.repoFullName}
                        </p>
                      </td>
                      <td className="px-3.5 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${badge.bg} ${badge.text}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3.5 py-3">
                        <span
                          className={`text-[13px] font-semibold ${scoreColor(
                            review.score
                          )}`}
                        >
                          {review.score}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 text-right">
                        <span className="text-[11px] text-[#888]">
                          {relativeTime(review.createdAt)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Connected repositories */}
      <div>
        <h2 className="text-[15px] font-semibold text-[#111] mb-3">
          Connected repositories
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          {repos.map((repo) => (
            <div
              key={repo.id}
              className="bg-white border border-[#e5e5e3] rounded-lg p-3.5 flex items-center justify-between"
            >
              <div>
                <p className="text-[13px] font-medium text-[#111]">
                  {repo.repoFullName}
                </p>
                <p className="text-[11px] text-[#888] mt-0.5">
                  {repo._count.reviews} PRs reviewed
                </p>
              </div>
              <div
                className={`w-[36px] h-[20px] rounded-full ${
                  repo.active ? "bg-[#111]" : "bg-[#e5e5e3]"
                } relative`}
              >
                <span
                  className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] rounded-full bg-white ${
                    repo.active ? "translate-x-[16px]" : "translate-x-0"
                  }`}
                />
              </div>
            </div>
          ))}

          {/* Add repo card */}
          <Link
            href="/repositories"
            className="border-2 border-dashed border-[#e5e5e3] rounded-lg p-3.5 flex items-center justify-center hover:border-[#ccc] transition-colors duration-150"
          >
            <div className="text-center">
              <p className="text-[13px] font-medium text-[#888]">
                + Connect a repo
              </p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
