"use client";

import { useTransition } from "react";

export function DeleteButton({
  action,
  id,
  title,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  title: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
        startTransition(() => action(formData));
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
      >
        {pending ? "…" : "Delete"}
      </button>
    </form>
  );
}
