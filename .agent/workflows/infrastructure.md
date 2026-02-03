---
description: Infrastructure access and tooling for Pulse Platform development
---

# Pulse Platform Infrastructure Access

## Railway CLI
You have direct access to Railway for deployments:
```bash
npx @railway/cli status           # Check project status
npx @railway/cli logs             # View deployment logs  
npx @railway/cli deployment list  # List recent deployments
npx @railway/cli deployment up    # Manual deploy from current directory
```

**Project**: Pulse  
**Environment**: production  
**Service**: pulse  

## Supabase Direct Access
You have direct SQL access to Supabase via `db-run.js` located at `/Users/joegriffin/Documents/anti/Pulse/db-run.js`:

### Running SQL
```bash
# Run from Pulse directory (not pulse-platform-ui)
cd /Users/joegriffin/Documents/anti/Pulse
# Run a query
node db-run.js "SELECT * FROM accounts LIMIT 5"

# Run a migration file  
cat migrations/003_create_schema_org.sql | node db-run.js

# DDL/DML statements
node db-run.js "CREATE TABLE test (id uuid PRIMARY KEY)"
```

### Database Tables
Key tables you can query/modify:
- `accounts` - Client accounts (id, hs_account_id, account_name)
- `page_index` - Crawled pages (id, url, title, page_type, site_id)
- `site_index` - Site crawl data (id, url, domain, account_id)
- `schema_org` - Page type to schema.org mappings
- `prompts` - AI prompts configuration
- `answers` - AI-generated answers

## GitHub Repo
- **Repo**: deangarland/pulse
- **Branch**: main (auto-deploys to Railway)
- Push to `main` triggers Railway deployment

## Key Reminders
- Always run `npm run build` locally before pushing to catch TypeScript errors
- Railway builds fail on unused imports (strict TypeScript)
- Use `hs_account_id` for short account IDs (not `account_id`)
