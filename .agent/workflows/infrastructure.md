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
You have direct SQL access to Supabase via psql or the Supabase CLI.

### Database Tables
Key tables you can query/modify:
- `accounts` - Client accounts (id, hs_account_id, account_name)
- `page_index` - Crawled pages (id, url, title, page_type, account_id)
- `site_index` - Site crawl data
- `locations` - Location taxonomy (name, address, city, state, primary)
- `procedures` - Procedure taxonomy (name, category, description, primary)
- `prompts` - AI prompts configuration
- `answers` - AI-generated answers

### Connection
Use the Supabase connection string from environment or:
```bash
npx supabase db query "SELECT * FROM accounts LIMIT 5"
```

## GitHub Repo
- **Repo**: deangarland/pulse
- **Branch**: main (auto-deploys to Railway)
- Push to `main` triggers Railway deployment

## Key Reminders
- Always run `npm run build` locally before pushing to catch TypeScript errors
- Railway builds fail on unused imports (strict TypeScript)
- Use `hs_account_id` for short account IDs (not `account_id`)
