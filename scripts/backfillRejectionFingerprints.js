
import db from '../src/database/db.js';
import crypto from 'node:crypto';

function createRejectionFingerprint(item) {
  let rawRecord = item.raw_record;

  if (typeof rawRecord === 'string') {
    try {
      rawRecord = JSON.parse(rawRecord);
    } catch {
      // Preserve the original value if it isn't valid JSON.
    }
  }

  if (
    rawRecord &&
    typeof rawRecord === 'object' &&
    !Array.isArray(rawRecord)
  ) {
   rawRecord = { ...rawRecord };

   // Remove run-specific fields from the transaction payload.
   delete rawRecord.ingestion_run_id;
   delete rawRecord.ingestion_timestamp;

   if (rawRecord._meta && typeof rawRecord._meta === 'object') {
         rawRecord._meta = { ...rawRecord._meta };
         delete rawRecord._meta.run_id;
         delete rawRecord._meta.ingestion_timestamp;
       }
     }

  const fingerprintData = JSON.stringify({
    source_file: item.source_file || 'unknown',
    entity_type: item.entity_type || 'UNKNOWN',
    record_id: item.record_id || null,
    rejection_reason: item.rejection_reason || 'Validation failure',
    raw_record: rawRecord
  });

  return crypto
    .createHash('sha256')
    .update(fingerprintData)
    .digest('hex');
}

async function backfillFingerprints() {
  try {
    const rows = await db.query(
      `SELECT id, source_file, entity_type, record_id,
              rejection_reason, raw_record
       FROM rejected_records
       ORDER BY id ASC`
    );

    console.log(`Found ${rows.length} rejected records.`);

    for (const row of rows) {
      const fingerprint = createRejectionFingerprint(row);

      await db.execute(
        `UPDATE rejected_records
         SET rejection_fingerprint = ?
         WHERE id = ?`,
        [fingerprint, row.id]
      );

      console.log(`Updated record ID: ${row.id}`);
    }

    console.log('Fingerprint backfill completed successfully.');
  } catch (error) {
    console.error('Fingerprint backfill failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

backfillFingerprints();
