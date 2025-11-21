# Database Migration Scripts

This directory contains database migration and maintenance scripts for the Hushwork backend.

## Available Scripts

### `migrateEncryption.js`

Fixes users with `is_masked: true` but unencrypted sensitive data.

**Problem**: Due to a bug, some users may have `is_masked` set to `true` but their sensitive fields (email, name, phone, location) are stored in plain text instead of being encrypted.

**Solution**: This script identifies and encrypts those users' data properly.

#### Usage

**Dry Run (Safe - No Changes)**:
```bash
cd backend
node scripts/migrateEncryption.js --dry-run
```

This will:
- Analyze your database
- Show how many users need encryption
- Display detailed statistics
- Make NO changes

**Live Run (Applies Changes)**:
```bash
cd backend
node scripts/migrateEncryption.js
```

This will:
- Find all users with `is_masked: true`
- Check which ones have unencrypted data
- Encrypt their sensitive fields
- Update the database
- Show detailed statistics

#### Prerequisites

1. **ENCRYPTION_KEY must be configured** in `backend/.env`:
   ```env
   ENCRYPTION_KEY=<64-character-hex-string>
   ```

2. Generate a key if you don't have one:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

#### What Gets Encrypted

The following sensitive fields are encrypted:
- `user_email_id`
- `actual_user_name`
- `user_phone_number`
- `secondary_email_id`
- `user_location`

#### Output Example

```
🔐 Encryption key configured correctly
🔍 Running in DRY RUN mode - no changes will be made

Fetching users with is_masked: true...
Found 150 users with is_masked: true

📊 Analysis:
  - Total users with is_masked=true: 150
  - Already properly encrypted: 140
  - Need encryption: 10

Processing users...
Processing user: 507f1f77bcf86cd799439011 (user@example.com)
  ✓ Encrypted field: user_email_id
  ✓ Encrypted field: actual_user_name
  [DRY RUN] Would encrypt user 507f1f77bcf86cd799439011

============================================================
📊 Migration Summary:
============================================================
Total users with is_masked=true: 150
Already encrypted: 140
Needed encryption: 10
Successfully encrypted: 10
Failed: 0
Skipped: 0
============================================================
✅ Successfully encrypted 10 users

💡 This was a dry run. Run without --dry-run to apply changes.
```

#### Safety Features

- **Dry Run Mode**: Test before applying changes
- **Validation**: Verifies encryption succeeded before saving
- **Detailed Logging**: See exactly what's happening
- **Error Handling**: Continues processing even if one user fails
- **Statistics**: Complete summary of all operations

#### When to Run

Run this script if:
1. You've added the `ENCRYPTION_KEY` to your environment
2. You have existing users in the database
3. You suspect some users have `is_masked: true` with unencrypted data
4. After fixing the encryption bug in production

#### Troubleshooting

**"ENCRYPTION_KEY not configured"**:
- Add `ENCRYPTION_KEY` to `backend/.env`
- Make sure it's a 64-character hex string (32 bytes)

**"Failed to encrypt user"**:
- Check the detailed error message in logs
- Verify the encryption key is valid
- Ensure the user document exists

**Script hangs or times out**:
- Increase MongoDB connection timeouts
- Run during low-traffic periods
- Process in batches if you have many users

## Best Practices

1. **Always run with `--dry-run` first** to see what will be changed
2. **Backup your database** before running live migrations
3. **Run during maintenance windows** for large datasets
4. **Monitor logs** for any errors or warnings
5. **Verify results** by checking a few users in the database

## Adding New Migration Scripts

When creating new migration scripts:

1. Use the same structure as `migrateEncryption.js`
2. Include `--dry-run` mode
3. Provide detailed logging
4. Handle errors gracefully
5. Document usage in this README
