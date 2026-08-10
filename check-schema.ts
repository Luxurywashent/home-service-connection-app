import mysql from "mysql2/promise";

async function checkSchema() {
  try {
    const connection = await mysql.createConnection(process.env.DATABASE_URL || "");
    const [rows] = await connection.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'door_hanger_entries' AND TABLE_SCHEMA = DATABASE()"
    );
    console.log("Columns in door_hanger_entries:", rows);
    await connection.end();
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
  }
  process.exit(0);
}

checkSchema();
