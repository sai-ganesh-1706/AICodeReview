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

function statusBadge(comments: { severity: string }[]): {
  label: string;
  bg: string;
  text: string;
} {
  const hasCritical = comments.some((c) => c.severity === "CRITICAL");
  const hasWarning = comments.some((c) => c.severity === "WARNING");

  if (hasCritical)
    return { label: "Critical", bg: "bg-[#fef2f2]", text: "text-[#b91c1c]" };
  if (hasWarning)
    return { label: "Warning", bg: "bg-[#fffbeb]", text: "text-[#b45309]" };
  return { label: "Clean", bg: "bg-[#f0fdf4]", text: "text-[#16a34a]" };
}

export default async function ReviewsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const reviews = await prisma.review.findMany({
    where: { repository: { userId: session.user.id } },
    include: {
      repository: { select: { repoFullName: true } },
      comments: { select: { severity: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold text-[#111]">Reviews</h1>
        <p className="text-[13px] text-[#555] mt-0.5">
          {reviews.length} review{reviews.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Reviews list */}
      {reviews.length === 0 ? (
        <div className="bg-white border border-[#e5e5e3] rounded-lg p-3.5 text-center">
          <p className="text-[13px] text-[#888]">
            No reviews yet. Open a pull request on a connected repository to get
            started.
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
                <th className="text-left text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                  Comments
                </th>
                <th className="text-right text-[11px] font-medium text-[#888] uppercase tracking-wide px-3.5 py-2.5">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((review) => {
                const badge = statusBadge(review.comments);
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
                    <td className="px-3.5 py-3">
                      <span className="text-[13px] text-[#555]">
                        {review.comments.length}
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
  );
}
