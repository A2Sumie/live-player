import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: 'd15dd1a7-ccd9-4b7c-8309-0f8a586ac881',
    token: process.env.CLOUDFLARE_API_TOKEN!,
  },
});