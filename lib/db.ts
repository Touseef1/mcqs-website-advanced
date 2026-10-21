import mysql from "mysql2/promise";

export const hasDatabase = Boolean(
  process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME,
);

export const db = hasDatabase
  ? mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
      queueLimit: 0,
      charset: "utf8mb4",
    })
  : null;
