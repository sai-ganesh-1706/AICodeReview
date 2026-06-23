import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

const severityConfig: Record<string, { border: string; label: string }> = {
  CRITICAL: { border: "border-l-[#dc2626]", label: "Critical" },
  WARNING: { border: "border-l-[#b45309]", label: "Warning" },
  SUGGESTION: { border: "border-l-[#2563eb]", label: "Suggestion" },
};

function scoreColor(score: number): string {
  if (score >= 80) return "text-[#16a34a]";
  if (score >= 60) return "text-[#b45309]";
  return "text-[#dc2626]";
}

export default async function ReviewDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const review = await prisma.review.findUnique({
    where: { id: params.id },
    include: {
      repository: true,
      comments: { orderBy: { filePath: "asc" } },
    },
  });

  if (!review) notFound();

  // Group comments by file
  const commentsByFile: Record<string, typeof review.comments> = {};
  for (const c of review.comments) {
    if (!commentsByFile[c.filePath]) commentsByFile[c.filePath] = [];
    commentsByFile[c.filePath].push(c);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <Link
          href="/dashboard"
          className="text-[13px] text-[#888] hover:text-[#555] transition-colors duration-150 mb-3 inline-block"
        >
          ← Back to dashboard
        </Link>
        <h1 className="text-[22px] font-semibold text-[#111]">
          {review.prTitle}
        </h1>
        <p className="text-[13px] text-[#555] mt-1">
          #{review.prNumber} · {review.repository.repoFullName} ·{" "}
          <a
            href={review.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#111] underline hover:text-[#555] transition-colors duration-150"
          >
            View on GitHub ↗
          </a>
        </p>
      </div>

      {/* Summary card */}
      <div className="bg-white border border-[#e5e5e3] rounded-lg p-3.5 mb-5">
        <div className="flex items-start justify-between gap-5">
          <div className="flex-1">
            <p className="text-[11px] font-medium text-[#888] uppercase tracking-wide mb-1.5">
              Summary
            </p>
            <p className="text-[13px] text-[#111] leading-relaxed">
              {review.summary}
            </p>
          </div>
          <div className="text-center shrink-0 pl-5 border-l border-[#e5e5e3]">
            <p className="text-[11px] font-medium text-[#888] uppercase tracking-wide mb-1">
              Score
            </p>
            <p
              className={`text-[22px] font-semibold ${scoreColor(
                review.score
              )}`}
            >
              {review.score}
            </p>
            <p className="text-[11px] text-[#888]">/ 100</p>
          </div>
        </div>
      </div>

      {/* Comments */}
      <div>
        <h2 className="text-[15px] font-semibold text-[#111] mb-3">
          Comments ({review.comments.length})
        </h2>

        {review.comments.length === 0 ? (
          <div className="bg-white border border-[#e5e5e3] rounded-lg p-3.5 text-center">
            <p className="text-[13px] text-[#888]">
              No issues found — clean PR ✓
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {Object.entries(commentsByFile).map(([filePath, comments]) => (
              <div key={filePath}>
                <p className="text-[11px] font-medium text-[#888] uppercase tracking-wide mb-1.5 font-mono">
                  {filePath}
                </p>
                <div className="flex flex-col gap-2.5">
                  {comments.map((c) => {
                    const config =
                      severityConfig[c.severity] ?? severityConfig.SUGGESTION;
                    return (
                      <div
                        key={c.id}
                        className={`bg-white border border-[#e5e5e3] rounded-lg p-3.5 border-l-[3px] ${config.border}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[11px] font-medium text-[#888]">
                            {config.label}
                          </span>
                          <span className="text-[11px] text-[#888]">·</span>
                          <span className="text-[11px] text-[#888] font-mono">
                            Line {c.lineNumber}
                          </span>
                        </div>
                        <p className="text-[13px] text-[#111] leading-relaxed">
                          {c.comment}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
