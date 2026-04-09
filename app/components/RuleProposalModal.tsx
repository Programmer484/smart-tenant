"use client";

import { useEffect, useRef } from "react";
import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import type { Question } from "@/lib/question";

export type Proposal = {
  newRules: LandlordRule[];
  modifiedRules: LandlordRule[];
  deletedRuleIds: string[];
  missingFields: LandlordField[];
  proposedQuestions: Question[];
};

export function RuleProposalModal({
  open,
  proposal,
  existingRules,
  existingQuestions,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  proposal: Proposal | null;
  existingRules: LandlordRule[];
  existingQuestions: Question[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  if (!open || !proposal) return null;

  const hasRuleChanges = proposal.newRules.length > 0 || proposal.modifiedRules.length > 0 || proposal.deletedRuleIds.length > 0;
  const hasStructuralChanges = proposal.missingFields.length > 0 || proposal.proposedQuestions.length > 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="fixed inset-0 z-50 m-auto max-w-xl rounded-xl border border-black/8 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="border-b border-black/5 p-6 pb-4">
          <h3 className="text-lg font-semibold text-[#1a2e2a]">Review Proposed Changes</h3>
          <p className="mt-1 text-sm text-[#1a2e2a]/60">
            {hasStructuralChanges 
              ? "The AI generated rules that require new fields. Please review the proposed scheme."
              : "Please review the proposed rule changes."}
          </p>
        </div>

        <div className="overflow-y-auto p-6 flex flex-col gap-6">
          {/* Deleted Rules */}
          {proposal.deletedRuleIds.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-red-600">Rules to Delete</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {proposal.deletedRuleIds.map((id, i) => {
                  const r = existingRules.find(er => er.id === id);
                  if (!r) return null;
                  return (
                    <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm flex items-start gap-2 opacity-70">
                      <span className="font-medium text-red-900/80 min-w-16 line-through">
                        {r.action === "reject" ? "Reject if:" : "Require:"}
                      </span>
                      <div className="flex flex-col text-red-900/70 line-through">
                        {r.conditions.map((c, idx) => (
                          <div key={idx}>
                            {idx > 0 && <span className="text-[11px] font-bold text-red-900/40 uppercase mr-1">and</span>}
                            {c.fieldId} {c.operator} {c.value}
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Modified Rules */}
          {proposal.modifiedRules.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600">Rules to Modify</h4>
              <ul className="mt-2 flex flex-col gap-3">
                {proposal.modifiedRules.map((rule, i) => {
                  const original = existingRules.find(er => er.id === rule.id);
                  return (
                    <li key={i} className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden shadow-sm">
                      {original && (
                        <div className="p-3 text-sm flex items-start gap-2 bg-black/5 opacity-60">
                          <span className="font-medium text-foreground/80 min-w-16 line-through">
                            {original.action === "reject" ? "Reject if:" : "Require:"}
                          </span>
                          <div className="flex flex-col text-foreground/70 line-through">
                            {original.conditions.map((c, idx) => (
                              <div key={idx}>
                                {idx > 0 && <span className="text-[11px] font-bold text-foreground/40 uppercase mr-1">and</span>}
                                {c.fieldId} {c.operator} {c.value}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="p-3 text-sm flex items-start gap-2 bg-white">
                        <span className="font-medium text-amber-900 min-w-16">
                          {rule.action === "reject" ? "Reject if:" : "Require:"}
                        </span>
                        <div className="flex flex-col text-amber-900/80">
                          {rule.conditions.map((c, idx) => (
                            <div key={idx} className="font-medium">
                              {idx > 0 && <span className="text-[11px] font-bold text-amber-700/60 uppercase mr-1">and</span>}
                              {c.fieldId} {c.operator} {c.value}
                            </div>
                          ))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* New Rules */}
          {proposal.newRules.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-teal-700">New Rules</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {proposal.newRules.map((rule, i) => (
                  <li key={i} className="rounded-lg border border-teal-100 bg-teal-50/30 p-3 text-sm flex items-start gap-2">
                    <span className="font-medium text-teal-900/80 min-w-16">
                      {rule.action === "reject" ? "Reject if:" : "Require:"}
                    </span>
                    <div className="flex flex-col text-teal-900/80 font-medium">
                      {rule.conditions.map((c, idx) => (
                        <div key={idx}>
                          {idx > 0 && <span className="text-[11px] font-bold text-teal-700/60 uppercase mr-1">and</span>}
                          {c.fieldId} {c.operator} {c.value}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing Fields */}
          {proposal.missingFields.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-600">Fields to Add</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {proposal.missingFields.map((f, i) => (
                  <div key={i} className="rounded border border-purple-200 bg-purple-50 px-2 py-1 flex items-center gap-1.5 shadow-sm">
                    <span className="text-xs font-medium text-purple-900">{f.label || f.id}</span>
                    <span className="text-[10px] text-purple-700/60 uppercase tracking-widest bg-purple-100 px-1 rounded">{f.value_kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Question Updates */}
          {proposal.proposedQuestions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-blue-600">Question Flow Updates</h4>
              <ul className="mt-2 flex flex-col gap-3">
                {proposal.proposedQuestions.map((q, i) => {
                  const existing = existingQuestions.find((eq) => eq.id === q.id);
                  const isUpdate = !!existing;

                  return (
                    <li key={i} className="rounded-xl border border-blue-100 bg-blue-50/30 overflow-hidden shadow-sm">
                      <div className="bg-blue-100/50 px-3 py-1.5 flex items-center justify-between text-[11px] font-semibold text-blue-800 uppercase tracking-wide">
                        {isUpdate ? "Modified Existing Question" : "New Question"}
                      </div>
                      <div className="p-3 bg-white flex flex-col gap-2 relative">
                        {isUpdate && existing.text !== q.text && (
                          <div className="text-sm text-foreground/40 line-through mb-1">{existing.text}</div>
                        )}
                        <div className="text-sm font-medium text-foreground">{q.text}</div>
                        
                        <div className="flex flex-wrap gap-1 mt-1">
                          {q.fieldIds.map((fid) => {
                            const isNewlyLinked = isUpdate && !existing.fieldIds.includes(fid);
                            return (
                              <span key={fid} className={`text-[10px] rounded px-1.5 py-0.5 ${isNewlyLinked ? "bg-amber-100 text-amber-800 font-bold border border-amber-200" : "bg-black/5 text-black/50 border border-black/5"}`}>
                                {isNewlyLinked ? "+" : ""}
                                {fid}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {!hasRuleChanges && !hasStructuralChanges && (
            <p className="text-sm text-foreground/50 italic">No meaningful changes were proposed.</p>
          )}
        </div>

        <div className="border-t border-black/5 p-6 pt-4 flex justify-end gap-3 bg-[#f7f9f8]/50">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#1a2e2a]/60 transition-colors hover:bg-black/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!hasRuleChanges && !hasStructuralChanges}
            className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
          >
            Accept & Apply
          </button>
        </div>
      </div>
    </dialog>
  );
}
