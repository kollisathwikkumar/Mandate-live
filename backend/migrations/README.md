# PostgreSQL migrations

The release includes ordered migrations `001`–`026`. Treat numbered migrations as immutable and add their SHA-256 digest to `checksums.json` in the same change. The migrator validates the complete manifest before applying SQL and records each digest in `schema_migrations`; mismatches stop execution before SQL is applied. Apply migrations only to the intended database after checking its identity and a verified backup. There are no automatic down migrations.
