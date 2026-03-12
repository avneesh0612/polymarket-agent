import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL env var");
}

export const sql = postgres(connectionString);
