"use client";

import { useTransition } from "react";

export default function ToggleSwitch({
  repoId,
  active,
  toggleAction,
}: {
  repoId: string;
  active: boolean;
  toggleAction: (repoId: string) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleAction(repoId);
        });
      }}
      className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-150 ${
        active ? "bg-[#111]" : "bg-[#e5e5e3]"
      } ${isPending ? "opacity-50" : ""}`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] rounded-full bg-white transition-transform duration-150 ${
          active ? "translate-x-[16px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}
