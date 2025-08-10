declare global {
  namespace CloudflareEnv {
    interface Env {
      DB: D1Database;
    }
  }

  var DB: D1Database;
}