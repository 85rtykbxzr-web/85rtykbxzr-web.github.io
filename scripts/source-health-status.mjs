function skipNote(source) {
  return source.skipReason || "source snapshot intentionally skipped";
}

function createSkippedSourceSnapshotResult(source, checkedAt = new Date().toISOString()) {
  const note = skipNote(source);
  return {
    health: {
      sourceId: source.id,
      url: source.url,
      ok: null,
      blocking: false,
      status: null,
      checkedAt,
      skipped: true,
      note
    },
    candidate: {
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      skipped: true,
      note
    }
  };
}

function isIntentionallySkippedSourceHealth(row) {
  if (row?.skipped === true) return true;

  // Compatibility with source-health snapshots generated before skipped probes
  // had an explicit state. Those rows used HTTP-like 204 plus an explanatory warning.
  const legacyNote = String(row?.warning || row?.note || "");
  return (
    row?.ok === true &&
    row?.blocking === false &&
    Number(row?.status) === 204 &&
    /(?:skipp|생략|제외)/i.test(legacyNote)
  );
}

function isNonBlockingSourceHealthWarning(row) {
  if (isIntentionallySkippedSourceHealth(row)) return false;
  return (row?.ok === false && row?.blocking === false) || Boolean(row?.warning);
}

export {
  createSkippedSourceSnapshotResult,
  isIntentionallySkippedSourceHealth,
  isNonBlockingSourceHealthWarning
};
