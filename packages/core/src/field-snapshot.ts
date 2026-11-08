import type { FieldSnapshot, TypedField, TransactionAssessment } from './semantic-types.js';

/** Copy SDK-owned containers, preserving opaque application resolver values as-is.
 * Public result edits must not attest printing/signature or alter native NFPAG constraints.
 * Do not structuredClone unknown values: applications may return functions or class instances.
 */
export function copyFieldSnapshot(snapshot: FieldSnapshot): FieldSnapshot {
  const field = (value: TypedField): TypedField => ({ ...value });
  const assessment = snapshot.assessment;
  const copiedAssessment: TransactionAssessment | undefined = assessment && {
    ...assessment,
    issues: [...assessment.issues],
    fields: assessment.fields?.map(field),
    productConstraints: assessment.productConstraints?.map(value => ({
      ...value,
      scope: value.scope && { ...value.scope },
      fieldTypes: [...value.fieldTypes],
      raw: { ...value.raw }
    }))
  };
  if (copiedAssessment && assessment) {
    for (const key of ['approved', 'balance', 'received', 'inputAmount', 'change'] as const) {
      const value = assessment[key];
      if (value) copiedAssessment[key] = { ...value };
    }
  }
  return {
    ...snapshot,
    fields: snapshot.fields.map(field),
    receipts: snapshot.receipts.map(receipt => ({ ...receipt })),
    bills: Object.fromEntries(Object.entries(snapshot.bills).map(([key, values]) => [key, values.map(field)])),
    nfpag: {
      ...snapshot.nfpag,
      types: Object.fromEntries(Object.entries(snapshot.nfpag.types).map(([key, value]) => [key, {
        ...value, fields: [...value.fields], allowedNetworks: value.allowedNetworks && [...value.allowedNetworks]
      }]))
    },
    diagnostics: snapshot.diagnostics.map(value => ({ ...value })),
    assessment: copiedAssessment
  };
}
