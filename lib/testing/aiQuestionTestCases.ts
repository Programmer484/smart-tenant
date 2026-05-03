import type { LandlordField } from "@/lib/landlord-field";
import type { Question } from "@/lib/question";
import type { LandlordRule } from "@/lib/landlord-rule";

export type AIQuestionOutput = {
  newFields?: LandlordField[];
  questions?: Question[];
  deletedQuestionIds?: string[];
  
  // Rule generation fields (optional, if we want to support both)
  newRules?: LandlordRule[];
  modifiedRules?: LandlordRule[];
  deletedRuleIds?: string[];
};

export type TestCase = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  requirements: string[];
  mockOutput: AIQuestionOutput;
};

export const testCases: TestCase[] = [
  {
    id: "create_scratch_pet",
    name: "Create From Scratch - Pet Question",
    description: "Generates a brand new question and branch about pets",
    prompt: "I want to know if they have pets. If they do, ask what kind and how many.",
    requirements: [
      "Must collect a boolean field for has_pets",
      "Must have a question asking about pets",
      "Must have a conditional branch that triggers when has_pets is true",
      "The branch must contain follow-up questions for pet_type and pet_count",
    ],
    mockOutput: {
      newFields: [
        {
          id: "has_pets",
          label: "Do you have any pets?",
          value_kind: "boolean",
        },
        {
          id: "pet_type",
          label: "What type of pet(s)?",
          value_kind: "text",
        },
        {
          id: "pet_count",
          label: "How many pets?",
          value_kind: "number",
        },
      ],
      questions: [
        {
          id: "q_pets",
          text: "Do you have any pets?",
          fieldIds: ["has_pets"],
          sort_order: 0,
          branches: [
            {
              id: "b_pets_yes",
              condition: {
                fieldId: "has_pets",
                operator: "==",
                value: "true",
              },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_pet_details",
                  text: "Please tell us the type and number of pets.",
                  fieldIds: ["pet_type", "pet_count"],
                  sort_order: 0,
                  branches: [],
                },
              ],
            },
          ],
        },
      ],
      deletedQuestionIds: [],
    },
  },
  {
    id: "branching_income_proof",
    name: "Conditional Question - Income Proof",
    description: "Generates a conditional requirement based on an existing question",
    prompt: "If their income is less than 3000, ask for a co-signer.",
    requirements: [
      "Must use a condition where income is less than 3000",
      "Must add a field for co-signer details",
      "Must ask a follow-up question about the co-signer",
    ],
    mockOutput: {
      newFields: [
        {
          id: "cosigner_name",
          label: "Co-signer Name",
          value_kind: "text",
        },
      ],
      questions: [
        {
          id: "q_income",
          text: "What is your monthly income?",
          fieldIds: ["monthly_income"], // Assuming this exists or is implicitly used
          sort_order: 0,
          branches: [
            {
              id: "b_income_low",
              condition: {
                fieldId: "monthly_income",
                operator: "<",
                value: "3000",
              },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_cosigner",
                  text: "Since your income is below $3000, please provide a co-signer.",
                  fieldIds: ["cosigner_name"],
                  sort_order: 0,
                  branches: [],
                },
              ],
            },
          ],
        },
      ],
      deletedQuestionIds: [],
    },
  },
  {
    id: "modify_smoking",
    name: "Modify Existing Question - Smoking",
    description: "Modifies an existing question to ask for more details",
    prompt: "Change the smoking question to also ask if they smoke indoors or outdoors.",
    requirements: [
      "Must add a field for smoking location (indoors/outdoors)",
      "Must update the existing smoking question (q_smoking) to include the new field",
      "Must not delete the original question ID unless replacing it",
    ],
    mockOutput: {
      newFields: [
        {
          id: "smoking_location",
          label: "Smoking Location",
          value_kind: "enum",
          options: ["Indoors", "Outdoors"],
        },
      ],
      questions: [
        {
          id: "q_smoking", // Modifying existing
          text: "Do you smoke? If so, do you smoke indoors or outdoors?",
          fieldIds: ["smokes", "smoking_location"],
          sort_order: 0,
          branches: [],
        },
      ],
      deletedQuestionIds: [],
    },
  },
];
